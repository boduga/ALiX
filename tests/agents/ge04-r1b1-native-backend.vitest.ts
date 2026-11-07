import {expect,test} from 'vitest';
import {createNativeLauncherQualificationBackend} from '../../src/agents/worker-supervisor-native-backend.js';

test.skipIf(process.platform!=='linux'||process.getuid?.()===0)('native qualification backend refuses unprivileged composition',()=>{
 expect(()=>createNativeLauncherQualificationBackend({
   launcherPath:'/usr/bin/id',selections:new Map(),
 })).toThrow(/requires trusted root supervisor/);
});
