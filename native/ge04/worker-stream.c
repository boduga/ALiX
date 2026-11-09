/* Native accepted-socket/per-fragment authentication. No spawn, broker effects,
 * credentials, Node internals or stdout attestation. Linux qualification only. */
#define _GNU_SOURCE
#include "worker-stream.h"
#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <poll.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/un.h>
#include <time.h>
#include <unistd.h>

static void close_owned(struct ge04_stream_session *s) {
 if(s->fd>=0)close(s->fd);
 if(s->pidfd>=0)close(s->pidfd);
 s->fd=s->pidfd=-1;
}
static int fail(struct ge04_stream_session *s,int status) {
 if(s){close_owned(s);s->state=GE04_STREAM_FAILED;}
 return status;
}
void ge04_stream_destroy(struct ge04_stream_session *s) {
 if(s){close_owned(s);s->state=GE04_STREAM_CLOSED;}
}
static int64_t now_ms(void) {
 struct timespec t;
 if(clock_gettime(CLOCK_MONOTONIC,&t))return -1;
 return (int64_t)t.tv_sec*1000+t.tv_nsec/1000000;
}
static int64_t deadline(int ms) {
 int64_t now=now_ms();
 return ms>=100&&ms<=5000&&now>=0?now+ms:-1;
}
static int small_file(const char *path,char *out,size_t cap) {
 int fd=open(path,O_RDONLY|O_CLOEXEC|O_NOFOLLOW);
 if(fd<0)return 0;
 size_t used=0;
 while(used<cap-1){
  ssize_t n=read(fd,out+used,cap-1-used);
  if(n<0){close(fd);return 0;}
  if(!n){out[used]=0;close(fd);return 1;}
  used+=(size_t)n;
 }
 close(fd);return 0;
}
static int decimal(const char *text,uint64_t *value) {
 if(!text||!*text)return 0;
 uint64_t n=0;
 for(const char *p=text;*p;p++){
  if(*p<'0'||*p>'9'||n>(UINT64_MAX-(unsigned)(*p-'0'))/10)return 0;
  n=n*10+(unsigned)(*p-'0');
 }
 *value=n;return 1;
}
static int start_ticks(pid_t pid,uint64_t *ticks) {
 char path[64],buf[8192],prefix[48];
 snprintf(path,sizeof(path),"/proc/%ld/stat",(long)pid);
 snprintf(prefix,sizeof(prefix),"%ld (",(long)pid);
 if(!small_file(path,buf,sizeof(buf))||strncmp(buf,prefix,strlen(prefix)))return 0;
 char *end=strrchr(buf,')'),*save=NULL;
 if(!end||end[1]!=' ')return 0;
 char *token=strtok_r(end+2," \n",&save);
 if(!token||strlen(token)!=1||strchr("ZXx",token[0]))return 0;
 for(int i=1;i<=19;i++){
  token=strtok_r(NULL," \n",&save);
  if(!token)return 0;
 }
 return decimal(token,ticks)&&*ticks>0;
}
static int four_ids(const char *line,unsigned long expected) {
 unsigned long a,b,c,d;int used=0;
 if(sscanf(line,"%lu %lu %lu %lu %n",&a,&b,&c,&d,&used)!=4||line[used])return 0;
 return a==expected&&b==expected&&c==expected&&d==expected;
}
static int zero_hex(const char *line) {
 while(*line==' '||*line=='\t')line++;
 if(!*line)return 0;
 for(;*line;line++)if(*line!='0')return 0;
 return 1;
}
static int restricted_ids(const struct ge04_stream_peer *p) {
 char path[64],buf[16384],*save=NULL;
 snprintf(path,sizeof(path),"/proc/%ld/status",(long)p->pid);
 if(!small_file(path,buf,sizeof(buf)))return 0;
 unsigned seen=0;
 for(char *line=strtok_r(buf,"\n",&save);line;line=strtok_r(NULL,"\n",&save)){
  unsigned bit=0;int valid=1;
  if(!strncmp(line,"Uid:",4)){bit=1;valid=four_ids(line+4,p->uid);}
  else if(!strncmp(line,"Gid:",4)){bit=2;valid=four_ids(line+4,p->gid);}
  else if(!strncmp(line,"Groups:",7)){
   bit=4;const char *v=line+7;while(*v==' '||*v=='\t')v++;valid=!*v;
  }else if(!strncmp(line,"NoNewPrivs:",11)){
   bit=8;const char *v=line+11;while(*v==' '||*v=='\t')v++;valid=!strcmp(v,"1");
  }else if(!strncmp(line,"CapInh:",7)){bit=16;valid=zero_hex(line+7);}
  else if(!strncmp(line,"CapPrm:",7)){bit=32;valid=zero_hex(line+7);}
  else if(!strncmp(line,"CapEff:",7)){bit=64;valid=zero_hex(line+7);}
  else if(!strncmp(line,"CapAmb:",7)){bit=128;valid=zero_hex(line+7);}
  if(!valid||(bit&&(seen&bit)))return 0;
  seen|=bit;
 }
 return seen==255;
}
static int live(struct ge04_stream_session *s) {
 struct pollfd fds[2]={{.fd=s->pidfd,.events=POLLIN},{.fd=s->cancel_fd,.events=POLLIN}};
 if(poll(fds,2,0)!=0)return 0;
 uint64_t before,after;
 if(!start_ticks(s->peer.pid,&before)||before!=s->peer.start_ticks||
    !restricted_ids(&s->peer)||!start_ticks(s->peer.pid,&after)||before!=after)return 0;
 return poll(fds,2,0)==0;
}
static int check(struct ge04_stream_session *s,int64_t until) {
 if(!live(s))return GE04_STREAM_DENIED;
 int64_t now=now_ms();
 return now<0?GE04_STREAM_DENIED:now>=until?GE04_STREAM_TIMEOUT:GE04_STREAM_OK;
}
static int ready(struct ge04_stream_session *s,int fd,short events,int64_t until) {
 for(;;){
  int status=check(s,until);if(status)return status;
  int64_t now=now_ms();
  if(now<0)return GE04_STREAM_DENIED;
  if(now>=until)return GE04_STREAM_TIMEOUT;
  struct pollfd fds[3]={{.fd=s->cancel_fd,.events=POLLIN},
   {.fd=s->pidfd,.events=POLLIN},{.fd=fd,.events=events}};
  int n=poll(fds,3,(int)(until-now));
  if(n<0){if(errno==EINTR)continue;return GE04_STREAM_DENIED;}
  if(!n)continue;
  if(fds[0].revents||fds[1].revents||
     (fds[2].revents&(POLLHUP|POLLERR|POLLNVAL)))return GE04_STREAM_DENIED;
  if(fds[2].revents&events)return GE04_STREAM_OK;
 }
}
int ge04_stream_accept(struct ge04_stream_session *s,int listener,int cancel_fd,
 const struct ge04_stream_peer *p,int ms) {
 if(!s)return GE04_STREAM_DENIED;
 int64_t until=deadline(ms);
 struct stat st;int type,accepting,passcred;socklen_t n=sizeof(int);
 struct sockaddr_un address;socklen_t address_size=sizeof(address);
 int listener_flags=fcntl(listener,F_GETFL),control_flags=fcntl(cancel_fd,F_GETFL);
 if(s->state!=GE04_STREAM_FRESH||until<0||!p||p->pid<=1||!p->start_ticks||
    !p->uid||!p->gid||p->uid==getuid()||p->uid==geteuid()||
    p->gid==getgid()||p->gid==getegid()||cancel_fd<3||control_flags<0||
    (control_flags&O_ACCMODE)!=O_RDONLY||fstat(cancel_fd,&st)||!S_ISFIFO(st.st_mode)||
    listener_flags<0||!(listener_flags&O_NONBLOCK)||
    getsockopt(listener,SOL_SOCKET,SO_TYPE,&type,&n)||type!=SOCK_STREAM||
    getsockopt(listener,SOL_SOCKET,SO_ACCEPTCONN,&accepting,&n)||!accepting||
    getsockopt(listener,SOL_SOCKET,SO_PASSCRED,&passcred,&n)||passcred!=1||
    getsockname(listener,(struct sockaddr*)&address,&address_size)||address.sun_family!=AF_UNIX)
  return fail(s,GE04_STREAM_DENIED);
#ifdef SO_PASSPIDFD
 int passpidfd=0;
 if(getsockopt(listener,SOL_SOCKET,SO_PASSPIDFD,&passpidfd,&n)==0){
  if(passpidfd)return fail(s,GE04_STREAM_DENIED);
 }else if(errno!=ENOPROTOOPT)return fail(s,GE04_STREAM_DENIED);
#endif
 s->peer=*p;s->cancel_fd=cancel_fd;
#ifdef SYS_pidfd_open
 s->pidfd=(int)syscall(SYS_pidfd_open,p->pid,0);
#endif
 if(s->pidfd<0||!live(s))return fail(s,GE04_STREAM_DENIED);
 for(;;){
  int status=ready(s,listener,POLLIN,until);
  if(status)return fail(s,status);
  s->fd=accept4(listener,NULL,NULL,SOCK_CLOEXEC|SOCK_NONBLOCK);
  if(s->fd>=0)break;
  if(errno!=EINTR&&errno!=EAGAIN&&errno!=EWOULDBLOCK)return fail(s,GE04_STREAM_DENIED);
 }
 struct ucred cred;n=sizeof(cred);int one=1;
 if(getsockopt(s->fd,SOL_SOCKET,SO_PEERCRED,&cred,&n)||n!=sizeof(cred)||
    cred.pid!=p->pid||cred.uid!=p->uid||cred.gid!=p->gid||
    setsockopt(s->fd,SOL_SOCKET,SO_PASSCRED,&one,sizeof(one))||!live(s))
  return fail(s,GE04_STREAM_DENIED);
 int final_status=check(s,until);if(final_status)return fail(s,final_status);
 s->state=GE04_STREAM_OPEN;
 return GE04_STREAM_OK;
}
static int controls(struct ge04_stream_session *s,struct msghdr *msg) {
 int valid=!(msg->msg_flags&(MSG_TRUNC|MSG_CTRUNC)),credentials=0;
 if(msg->msg_flags&MSG_CTRUNC)s->saw_ctrunc=1;
 for(struct cmsghdr *c=CMSG_FIRSTHDR(msg);c;c=CMSG_NXTHDR(msg,c)){
  if(c->cmsg_len<CMSG_LEN(0)){valid=0;continue;}
  size_t bytes=c->cmsg_len-CMSG_LEN(0);
  if(c->cmsg_level==SOL_SOCKET&&(c->cmsg_type==SCM_RIGHTS
#ifdef SCM_PIDFD
      ||c->cmsg_type==SCM_PIDFD
#endif
      )){
   for(size_t i=0;i+sizeof(int)<=bytes;i+=sizeof(int)){
    int fd;memcpy(&fd,(char*)CMSG_DATA(c)+i,sizeof(fd));if(fd>=0)close(fd);
   }
   valid=0;
  }else if(c->cmsg_level==SOL_SOCKET&&c->cmsg_type==SCM_CREDENTIALS&&bytes==sizeof(struct ucred)){
   struct ucred cred;memcpy(&cred,CMSG_DATA(c),sizeof(cred));credentials++;
   if(cred.pid!=s->peer.pid||cred.uid!=s->peer.uid||cred.gid!=s->peer.gid)valid=0;
  }else valid=0;
 }
 return valid&&credentials==1;
}
static int receive_exact(struct ge04_stream_session *s,unsigned char *out,size_t length,int64_t until) {
 size_t used=0;
 while(used<length){
  int status=ready(s,s->fd,POLLIN,until);if(status)return status;
  union {struct cmsghdr align;unsigned char bytes[CMSG_SPACE(sizeof(struct ucred))+CMSG_SPACE(16*sizeof(int))];} control;
  struct iovec iov={.iov_base=out+used,.iov_len=length-used};
  struct msghdr msg={.msg_iov=&iov,.msg_iovlen=1,.msg_control=control.bytes,.msg_controllen=sizeof(control.bytes)};
  ssize_t n=recvmsg(s->fd,&msg,MSG_CMSG_CLOEXEC|MSG_DONTWAIT);
  if(n<0){if(errno==EINTR||errno==EAGAIN||errno==EWOULDBLOCK)continue;return GE04_STREAM_DENIED;}
  int valid=controls(s,&msg); /* Close received descriptors even on EOF/rejection. */
  if(!valid||n<=0)return GE04_STREAM_DENIED;
  status=check(s,until);if(status)return status;
  used+=(size_t)n;
 }
 return GE04_STREAM_OK;
}
int ge04_stream_read(struct ge04_stream_session *s,unsigned char *buffer,size_t capacity,size_t *length,int ms) {
 if(length)*length=0;
 int64_t until=deadline(ms);int status=GE04_STREAM_DENIED;
 if(!s||!buffer||capacity<GE04_STREAM_MAX_PAYLOAD||!length||until<0||s->state!=GE04_STREAM_OPEN)goto rejected;
 unsigned char header[8];
 status=receive_exact(s,header,sizeof(header),until);if(status)goto rejected;
 uint32_t size;memcpy(&size,header+4,4);size=ntohl(size);
 if(memcmp(header,"ALX1",4)||!size||size>GE04_STREAM_MAX_PAYLOAD){status=GE04_STREAM_DENIED;goto rejected;}
 status=receive_exact(s,buffer,size,until);if(status)goto rejected;
 status=check(s,until);if(status)goto rejected;
 *length=size;return GE04_STREAM_OK;
rejected:
 if(buffer&&capacity>=GE04_STREAM_MAX_PAYLOAD)memset(buffer,0,GE04_STREAM_MAX_PAYLOAD);
 return fail(s,status);
}
static int send_exact(struct ge04_stream_session *s,const unsigned char *buffer,size_t length,int64_t until) {
 size_t used=0;
 while(used<length){
  int status=ready(s,s->fd,POLLOUT,until);if(status)return status;
  ssize_t n=send(s->fd,buffer+used,length-used,MSG_NOSIGNAL|MSG_DONTWAIT);
  if(n<0){if(errno==EINTR||errno==EAGAIN||errno==EWOULDBLOCK)continue;return GE04_STREAM_DENIED;}
  if(!n)return GE04_STREAM_DENIED;
  status=check(s,until);if(status)return status;
  used+=(size_t)n;
 }
 return GE04_STREAM_OK;
}
int ge04_stream_write(struct ge04_stream_session *s,const unsigned char *buffer,size_t length,int ms) {
 int64_t until=deadline(ms);
 if(!s||s->state!=GE04_STREAM_OPEN||!buffer||!length||length>GE04_STREAM_MAX_PAYLOAD||until<0)
  return fail(s,GE04_STREAM_DENIED);
 unsigned char header[8];memcpy(header,"ALX1",4);uint32_t size=htonl((uint32_t)length);memcpy(header+4,&size,4);
 int status=send_exact(s,header,sizeof(header),until);
 if(!status)status=send_exact(s,buffer,length,until);
 return status?fail(s,status):GE04_STREAM_OK;
}
