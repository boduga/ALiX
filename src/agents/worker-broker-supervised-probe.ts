/** GE-04 Q3.28: supervised, credential-free native probe lifecycle.
 * Qualification-only: the native executable and socket directory must be
 * independently verified by a privileged deployment supervisor.
 */
import {spawn} from 'node:child_process';
import {spawnPinnedNativeProbe} from './worker-broker-pinned-probe.js';
import {parseNativePeerHandoff} from './worker-broker-native-handoff.js';
import type {NativePeerHandoff} from './worker-broker-native-handoff.js';

export type SupervisedProbeOptions=Readonly<{
  executable:string; socketPath:string; brokerUid:number; allowedUid:number;
  timeoutMs?:number;
  /** Opt-in Q3.30 descriptor-pinned native launch. Requires root-owned deployment. */
  trustedLauncherPath?:string;
  /** Disposable Linux test only: enables world-connectable test socket. */
  testPublicSocket?:boolean;
}>;
export async function runSupervisedNativeProbe(options:SupervisedProbeOptions):Promise<NativePeerHandoff>{
  if (!options || !options.executable?.startsWith('/') || !options.socketPath?.startsWith('/') ||
      !Number.isSafeInteger(options.brokerUid) || !Number.isSafeInteger(options.allowedUid) ||
      options.brokerUid<0 || options.allowedUid<0 || options.brokerUid===options.allowedUid)
    throw new Error('Invalid supervised probe configuration');
  const timeoutMs=options.timeoutMs??5000;
  if (!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw new Error('Invalid probe timeout');
  // No shell, no inherited stdin, no arbitrary inherited file descriptors.
  if(options.testPublicSocket && process.env.ALIX_GE04_Q330_LINUX_TEST!=='1')
    throw new Error('Public test socket requires explicit Q3.30 qualification gate');
  const args=[options.socketPath,String(options.brokerUid),String(options.allowedUid),
    ...(options.testPublicSocket?['--test-public-socket']:[])];
  const child=options.trustedLauncherPath
    ? spawnPinnedNativeProbe(options.executable,options.trustedLauncherPath,args)
    : spawn(options.executable,args,{stdio:['ignore','pipe','pipe'],shell:false,env:{PATH:'/usr/bin:/bin'}});
  return await new Promise<NativePeerHandoff>((resolve,reject)=>{
    let stdout='',stderr='',settled=false;
    const finish=(error?:Error,value?:NativePeerHandoff)=>{
      if(settled)return;settled=true;clearTimeout(timer);
      if(error){child.kill('SIGKILL');reject(error);}else resolve(value!);
    };
    const timer=setTimeout(()=>finish(new Error('Native probe timed out')),timeoutMs);
    child.stdout!.on('data',(chunk:Buffer)=>{
      stdout+=chunk.toString();if(stdout.length>256)finish(new Error('Native probe stdout exceeded limit'));
    });
    child.stderr!.on('data',(chunk:Buffer)=>{
      stderr+=chunk.toString();if(stderr.length>1024)finish(new Error('Native probe stderr exceeded limit'));
    });
    child.once('error',(err)=>finish(err));
    child.once('close',(code,signal)=>{
      if(code!==0||signal)return finish(new Error(`Native probe failed: ${code??signal}`));
      if(!stdout.startsWith('READY\n'))return finish(new Error('Native probe readiness missing'));
      try{finish(undefined,parseNativePeerHandoff(stdout.slice(6)));}
      catch(error){finish(error instanceof Error?error:new Error('Invalid native probe result'));}
    });
  });
}
