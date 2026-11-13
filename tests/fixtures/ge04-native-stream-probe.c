/* Secret-free bounded native transport fixture. Never install as a service,
 * setuid binary or sudo target. Only the trusted test controller chooses args. */
#define _GNU_SOURCE
#include "../../native/ge04/worker-stream.h"
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <unistd.h>

static int number(const char *s,unsigned long long max,unsigned long long *out) {
 if(!*s)return 0;
 unsigned long long n=0;
 for(;*s;s++){if(*s<'0'||*s>'9'||n>(max-(unsigned)(*s-'0'))/10)return 0;n=n*10+(unsigned)(*s-'0');}
 *out=n;return 1;
}
static int fd_count(void) {
 DIR *dir=opendir("/proc/self/fd");if(!dir)return -1;
 int n=0;struct dirent *entry;
 while((entry=readdir(dir)))if(strcmp(entry->d_name,".")&&strcmp(entry->d_name,".."))n++;
 closedir(dir);return n;
}
/* Pin and inspect all parent directories; never delete an existing socket. */
static int fixture_parent(const char *path) {
 const char *prefix="/run/ge04-stream-test-",*suffix="/peer.sock";
 size_t n=strlen(path),begin=strlen(prefix),tail=strlen(suffix);
 if(n>=sizeof(((struct sockaddr_un*)0)->sun_path)||n<=begin+tail||
    strncmp(path,prefix,begin)||strcmp(path+n-tail,suffix))return -1;
 for(size_t i=begin;i<n-tail;i++)if(!((path[i]>='a'&&path[i]<='z')||
    (path[i]>='A'&&path[i]<='Z')||(path[i]>='0'&&path[i]<='9')||path[i]=='_'||path[i]=='-'))return -1;
 char parent[108];memcpy(parent,path,n-tail);parent[n-tail]=0;
 int dir=open("/",O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(dir<0)return -1;
 struct stat st;
 if(fstat(dir,&st)||st.st_uid!=0||(st.st_mode&0022)){close(dir);return -1;}
 char *save=NULL;
 for(char *part=strtok_r(parent+1,"/",&save);part;part=strtok_r(NULL,"/",&save)){
  int next=openat(dir,part,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
  close(dir);dir=next;
  if(dir<0)return -1;
  if(fstat(dir,&st)||st.st_uid!=0||(st.st_mode&0022)){close(dir);return -1;}
 }
 if((st.st_mode&0777)!=0711){close(dir);return -1;}
 if(fstatat(dir,"peer.sock",&st,AT_SYMLINK_NOFOLLOW)==0||errno!=ENOENT){close(dir);return -1;}
 return dir;
}
int main(int argc,char **argv) {
 if(argc!=9)return 64;
 unsigned long long pid,uid,gid,ticks,cancel,ms;
 if(!number(argv[2],INT_MAX,&pid)||pid<=1||!number(argv[3],UINT_MAX,&uid)||
    !number(argv[4],UINT_MAX,&gid)||!number(argv[5],ULLONG_MAX,&ticks)||!ticks||
    !number(argv[6],INT_MAX,&cancel)||cancel<3||!number(argv[8],5000,&ms)||ms<100||
    (strcmp(argv[7],"echo1")&&strcmp(argv[7],"echo2")&&strcmp(argv[7],"backpressure")&&strcmp(argv[7],"blocking-listener")))return 64;
 if(getuid()!=0||geteuid()!=0)return 77;
 int dir=fixture_parent(argv[1]);if(dir<0)return 64;
 int listener=socket(AF_UNIX,SOCK_STREAM|SOCK_CLOEXEC|SOCK_NONBLOCK,0);
 int result=70,created=0;struct stat bound={0};
 if(listener<0)goto done;
 struct sockaddr_un address={.sun_family=AF_UNIX};strcpy(address.sun_path,argv[1]);
 int one=1;
 if(setsockopt(listener,SOL_SOCKET,SO_PASSCRED,&one,sizeof(one))||
    bind(listener,(struct sockaddr*)&address,sizeof(address)))goto done;
 created=1;
 if(fstatat(dir,"peer.sock",&bound,AT_SYMLINK_NOFOLLOW)||!S_ISSOCK(bound.st_mode)||bound.st_uid!=0||
    fchmodat(dir,"peer.sock",0666,0)||listen(listener,1))goto done;
 if(!strcmp(argv[7],"blocking-listener")&&fcntl(listener,F_SETFL,fcntl(listener,F_GETFL)&~O_NONBLOCK))goto done;
 int before=fd_count();if(before<0)goto done;
 puts("READY");fflush(stdout);
 struct ge04_stream_session session=GE04_STREAM_SESSION_INIT;
 struct ge04_stream_peer peer={.pid=(pid_t)pid,.uid=(uid_t)uid,.gid=(gid_t)gid,.start_ticks=ticks};
 int status=ge04_stream_accept(&session,listener,(int)cancel,&peer,(int)ms),frames=0;
 unsigned char payload[GE04_STREAM_MAX_PAYLOAD];size_t length=0;
 int count=!strcmp(argv[7],"echo2")?2:1;
 while(!status&&frames<count){
  status=ge04_stream_read(&session,payload,sizeof(payload),&length,(int)ms);
  if(status)break;
  if(!strcmp(argv[7],"backpressure")){
   int small=4096; socklen_t size=sizeof(small);
   if(setsockopt(session.fd,SOL_SOCKET,SO_SNDBUF,&small,sizeof(small))||
      getsockopt(session.fd,SOL_SOCKET,SO_SNDBUF,&small,&size)||small>16384){status=GE04_STREAM_DENIED;break;}
   memset(payload,'x',sizeof(payload));length=sizeof(payload);puts("WRITE");fflush(stdout);
  }
  status=ge04_stream_write(&session,payload,length,(int)ms);
  if(!status)frames++;
 }
 int retry=status?ge04_stream_read(&session,payload,sizeof(payload),&length,(int)ms):0;
 unsigned ctrunc=session.saw_ctrunc;
 ge04_stream_destroy(&session);ge04_stream_destroy(&session);
 int after=fd_count(),delta=after-before;
 printf("RESULT status=%d retry=%d fd_delta=%d frames=%d ctrunc=%u\n",status,retry,delta,frames,ctrunc);fflush(stdout);
 result=delta||after<0||(status&&retry!=GE04_STREAM_DENIED)?70:
  status==GE04_STREAM_OK?0:status==GE04_STREAM_TIMEOUT?75:77;
done:
 if(listener>=0)close(listener);
 if(created){
  struct stat current;
  if(fstatat(dir,"peer.sock",&current,AT_SYMLINK_NOFOLLOW)||!S_ISSOCK(current.st_mode)||
     current.st_dev!=bound.st_dev||current.st_ino!=bound.st_ino||unlinkat(dir,"peer.sock",0))result=70;
 }
 close(dir);return result;
}
