import test from 'node:test';
import assert from 'node:assert/strict';
import { FIXTURES, selectStratified, scoreRisks, summarize } from './pre-r031-agent-review-benchmark.mjs';

test('seeded stratified sample is deterministic and covers every stratum',()=>{
  const a=selectStratified(31031), b=selectStratified(31031);
  assert.deepEqual(a.map(x=>x.id),b.map(x=>x.id));
  assert.equal(a.length,4);
  assert.deepEqual([...new Set(a.map(x=>x.stratum))].sort(),['benign','correctness','provenance','security']);
});
test('scorer counts exact, missed critical and false positives without model judgement',()=>{
  const f=FIXTURES.find(x=>x.id==='false-success');
  assert.equal(scoreRisks(f,['false-success','unverified-outcome']).exact,true);
  const miss=scoreRisks(f,['unverified-outcome']); assert.deepEqual(miss.missedCritical,['false-success']);
  assert.equal(scoreRisks(f,['false-success','bogus']).falsePositives,1);
});
test('summary keeps sampling, safety, queue, cost and latency separate',()=>{
  const f=FIXTURES.find(x=>x.id==='benign-denial');
  const score=scoreRisks(f,[]);
  const row={fixtureId:f.id,stratum:f.stratum,disagreementIds:[],verifier:{score,fixtureCriticalCount:0,latencyMs:10,queueWaitMs:0},critic:{score,fixtureCriticalCount:0,latencyMs:20,queueWaitMs:0}};
  const s=summarize([row],[f],FIXTURES);
  assert.equal(s.quality.criticalMisses,0); assert.equal(s.cost.observed,0); assert.equal(s.latency.observed,2); assert.equal(s.sample.population,6);
});
