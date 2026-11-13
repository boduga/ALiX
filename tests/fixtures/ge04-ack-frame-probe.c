/* Unprivileged exact-ACK parser exercise. NEVER calls the privileged main. */
#define main ge04_native_root_entry_not_called
#include "../../native/ge04/cgroup-runtime-view-qualification.c"
#undef main

int main(int argc,char **argv) {
 if(argc!=2||(strcmp(argv[1],"phase")&&strcmp(argv[1],"two")))return 64;
 struct context c={0};
 strcpy(c.record.invocation,"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
 setvbuf(stdout,NULL,_IONBF,0);
 int ok=event_until(&c,"INTENT",begin_operation());
 printf("ACK_RESULT %d %u\n",ok,c.ack_sequence);
 if(!strcmp(argv[1],"two")&&ok){
  ok=event_until(&c,"PRE_NAMESPACE",begin_operation());
  printf("ACK_RESULT %d %u\n",ok,c.ack_sequence);
 }
 return 0;
}
