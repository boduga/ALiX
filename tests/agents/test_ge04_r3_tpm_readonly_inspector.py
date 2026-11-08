"""No TPM read/write is performed: readonly commands use mocked executors."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import stat
import unittest
from unittest.mock import patch

p=Path(__file__).resolve().parents[2]/"scripts/ge04-r3-tpm-readonly-inspector.py"
spec=importlib.util.spec_from_file_location("ge04_tpm_readonly_test",p)
inspector=importlib.util.module_from_spec(spec)
spec.loader.exec_module(inspector)

FIXED="""TPM2_PT_FAMILY_INDICATOR:
  raw: 0x322E3000
  value: "2.0"
TPM2_PT_MANUFACTURER:
  raw: 0x494E5443
  value: INTC
"""
VARIABLE="""TPM2_PT_PERMANENT:
  ownerAuthSet: 0
  disableClear: 0
TPM2_PT_NV_COUNTERS_AVAIL: 0x4
"""
CURVES="""TPM2_ECC_NIST_P256: 0x3
"""
HANDLES="""- 0x1410001
- 0x1410002
- 0x1800100
- 0x1880001
- 0x1880011
"""
NV_PUBLIC="""0x1880001:
  name: 000b1234
  hash algorithm:
    friendly: sha256
  attributes:
    friendly: policywrite|nt=0x1|writeall|ownerread|authread|written
  size: 8
"""

class ReadonlyTPMInspectorTests(unittest.TestCase):
    def setUp(self):
        self.commands=[]
        self.mock_stat=patch.object(inspector.os,"stat",
                                    return_value=SimpleNamespace(st_mode=stat.S_IFCHR|0o660))
        self.mock_stat.start()
        self.addCleanup(self.mock_stat.stop)

    def exec(self,args,**kwargs):
        self.commands.append(tuple(args))
        if args[0]=="tpm2_getcap":
            output=dict(zip(inspector.ALLOWED,
                            (FIXED,VARIABLE,CURVES,HANDLES)))[args[-1]]
        else:
            output=NV_PUBLIC
        return SimpleNamespace(returncode=0,stdout=output,stderr="")

    def test_readonly_inventory_parses_actual_hex_handles(self):
        result=inspector.inspect_tpm(executor=self.exec)
        self.assertTrue(result["inventoryObserved"])
        self.assertEqual(result["inventory"]["existingHandles"],
                         (hex(0x1410001),hex(0x1410002),hex(0x1800100),
                          hex(0x1880001),hex(0x1880011)))
        self.assertFalse(result["hardwareQualified"])
        self.assertFalse(result["authorizationGranted"])
        self.assertEqual([c[0] for c in self.commands],["tpm2_getcap"]*4)
        self.assertTrue(all("-T" in args for args in self.commands))

    def test_nv_public_read_is_readonly(self):
        result=inspector.inspect_nv_public("0x1880001",executor=self.exec)
        self.assertTrue(result["nvPublicObserved"])
        self.assertFalse(result["hardwareQualified"])
        self.assertEqual(self.commands[0][0],"tpm2_nvreadpublic")
        self.assertEqual(self.commands[0][-1],"0x1880001")

    def test_rejects_handle_injection(self):
        for handle in ("0x1880001;sudo tpm2_clear","", "not-a-handle",0x1880001):
            with self.subTest(handle=handle):
                self.assertFalse(inspector.inspect_nv_public(handle,executor=self.exec)
                                 .get("nvPublicObserved",False))
        self.assertEqual(self.commands,[])

    def test_does_not_use_fallback_or_sudo_on_access_error(self):
        def forbidden(args,**kwargs):
            self.commands.append(tuple(args))
            return SimpleNamespace(returncode=1,stdout="",stderr="permission denied")
        result=inspector.inspect_tpm(executor=forbidden)
        self.assertEqual(result["status"],"blocked")
        self.assertEqual(len(self.commands),1)
        self.assertNotIn("sudo",self.commands[0])
        self.assertFalse(result["hardwareQualified"])

    def test_no_device_no_commands(self):
        with patch.object(inspector.os,"stat",side_effect=FileNotFoundError()):
            result=inspector.inspect_tpm(executor=self.exec)
        self.assertFalse(result.get("inventoryObserved",False))
        self.assertEqual(self.commands,[])

    def test_unexpected_device_rejected_before_access(self):
        result=inspector.inspect_tpm(device="/dev/tpm0",executor=self.exec)
        self.assertEqual(result["status"],"blocked")
        self.assertEqual(self.commands,[])

    def test_malformed_properties_rejected(self):
        def malformed(args,**kwargs):
            return SimpleNamespace(returncode=0,stdout="hello",stderr="")
        self.assertFalse(inspector.inspect_tpm(executor=malformed)
                         .get("inventoryObserved",False))

    def test_inventory_cannot_authorize_anything(self):
        result=inspector.inspect_tpm(executor=self.exec)
        self.assertTrue(result["securityHoldActive"])
        self.assertFalse(result["authorizationGranted"])
        self.assertFalse(result["hardwareQualified"])


if __name__=="__main__":
    unittest.main()
