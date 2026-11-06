import {describe,it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createIsolatedBrokerAuthorizer} from '../../src/agents/worker-broker-authorization.js';
import {BrokerReplayLedger} from '../../src/agents/worker-broker-ipc-boundary.js';
import {createGovernedBrokerAdmission} from '../../src/agents/worker-broker-governed-admission.js';
const identity={coordinationRunId:'r',workerId:'w',attempt:1};
const peer={uid:10002,pid:456,transport:'unix-peer-credentials' as const};
const record={runId:'r',workerId:'w',attempt:1,status:'running',executionOwnerId:'daemon',planRevision:2,routeRevision:3,revoked:false};
const route={provider:'openai',name:'main'};
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'ge04-q326-'));const dbPath=join(dir,'ledger.sqlite');
 const current={...record};let now=1000;let liveIdentity={...identity};
 const authority={readClaim:async()=>({...current}),resolveRoute:async()=>({...route})};
 const key=Buffer.alloc(32,7);const authorizer=createIsolatedBrokerAuthorizer(authority,key,()=>now);
 const ledger=new BrokerReplayLedger(dbPath);
 const admission=createGovernedBrokerAdmission({peerPolicy:{brokerUid:10001,allowedWorkerUids:[10002]},
  resolveLivePeerClaim:async()=>({...liveIdentity}),authorizer,replayLedger:ledger,clock:()=>now});
 return {admission,authorizer,current,ledger,dbPath,setIdentity:(v:typeof identity)=>{liveIdentity=v;},advance:(n:number)=>{now+=n;},close:()=>{ledger.close();rmSync(dir,{recursive:true,force:true});}};
}
describe('GE-04 Q3.26 governed admission (credential-free)',()=>{
 it('binds attested peer to live worker claim and consumes replay durably',async()=>{
  const f=fixture();try{
   const t=await f.authorizer.issue(identity,'daemon');await expect(f.admission.admit(peer,t,'openai')).resolves.toBeUndefined();
   await expect(f.admission.admit(peer,t,'openai')).rejects.toThrow(/consumed/);
   const reopened=new BrokerReplayLedger(f.dbPath);try{expect(()=>reopened.consumeAuthenticated(t,1000)).toThrow(/consumed/);}finally{reopened.close();}
  }finally{f.close();}
 });
 it('rejects unauthorized peer and wrong live worker binding before ticket use',async()=>{
  const f=fixture();try{
   const t=await f.authorizer.issue(identity,'daemon');
   await expect(f.admission.admit({...peer,uid:10003},t,'openai')).rejects.toThrow(/unauthorized/);
   f.setIdentity({...identity,attempt:2});await expect(f.admission.admit(peer,t,'openai')).rejects.toThrow(/does not own/);
   f.setIdentity(identity);await expect(f.admission.admit(peer,t,'openai')).resolves.toBeUndefined();
  }finally{f.close();}
 });
 it('rejects revoked claims, unauthorized provider and expired tickets',async()=>{
  const f=fixture();try{
   const t=await f.authorizer.issue(identity,'daemon');
   await expect(f.admission.admit(peer,t,'anthropic')).rejects.toThrow(/not authorized/);
   f.current.revoked=true;await expect(f.admission.admit(peer,t,'openai')).rejects.toThrow();
   f.current.revoked=false;f.advance(30000);await expect(f.admission.admit(peer,t,'openai')).rejects.toThrow(/expired/);
  }finally{f.close();}
 });
});
