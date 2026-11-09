"""GE-04 R3 TPM2C: read-only NV public-shape contract qualification."""
from copy import deepcopy
import importlib.util
from pathlib import Path
import unittest

p=Path(__file__).resolve().parents[2]/"scripts/ge04-r3-tpm-readonly-anchor-contract.py"
spec=importlib.util.spec_from_file_location("ge04_r3_nv_contract_test",p)
contract=importlib.util.module_from_spec(spec)
spec.loader.exec_module(contract)

HANDLE="0x18a1000"
NAME="000b"+"a"*64
POLICY="b"*64
BASE_HANDLES=[
    "0x1410001","0x1410002","0x1800100","0x1880001","0x1880011",
]
PUBLIC={
    "name":NAME,
    "hash algorithm":{"friendly":"sha256","value":0xB},
    "attributes":{
        "friendly":"policywrite|nt=0x4|authread|written",
        "value":0x20060048,
    },
    "size":32,
    "authorization policy":POLICY,
}

class ReadOnlyAnchorContractTests(unittest.TestCase):
    def setUp(self):
        self.inventory={
            "status":"blocked","inventoryObserved":True,
            "authorizationGranted":False,"hardwareQualified":False,
            "inventory":{
                "properties-fixed":{"TPM2_PT_FAMILY_INDICATOR":{"value":"2.0"}},
                "properties-variable":{"TPM2_PT_PERMANENT":{
                    "ownerAuthSet":0,"disableClear":0}},
                "existingHandles":tuple(BASE_HANDLES),
            },
        }
        self.public={
            "status":"blocked","nvPublicObserved":True,"authorizationGranted":False,
            "handle":HANDLE,"metadata":deepcopy(PUBLIC),
        }

    def call(self, **overrides):
        arguments={
            "inventory_result":self.inventory, "handle":HANDLE,
            "nv_public_result":self.public,"expected_name":NAME,
            "expected_policy_digest":POLICY,"enrollment_id":"alix-qualification-fixture",
        }
        arguments.update(overrides)
        return contract.assess_nv_candidate(**arguments)

    def test_unallocated_candidate_is_not_auto_provisioned(self):
        result=self.call(nv_public_result=None)
        self.assertTrue(result.get("candidateAbsent"))
        self.assertFalse(result["hardwareQualified"])
        self.assertFalse(result["authorizationGranted"])
        self.assertTrue(result["securityHoldActive"])

    def test_matching_public_shape_still_cannot_authorize(self):
        self.inventory["inventory"]["existingHandles"] += (HANDLE,)
        result=self.call()
        self.assertTrue(result.get("publicShapeMatches"))
        self.assertFalse(result["independentAuthorityQualified"])
        self.assertFalse(result["rollbackResistant"])
        self.assertFalse(result["authorizationGranted"])
        self.assertEqual(result["status"],"blocked")

    def test_existing_firmware_indices_are_never_qualified(self):
        for handle in BASE_HANDLES:
            with self.subTest(handle=handle):
                result=self.call(handle=handle)
                self.assertFalse(result.get("publicShapeMatches",False))
                self.assertFalse(result.get("candidateAbsent",False))
                self.assertFalse(result["authorizationGranted"])

    def test_fake_public_for_absent_handle_rejected(self):
        result=self.call()
        self.assertFalse(result.get("publicShapeMatches",False))
        self.assertFalse(result.get("candidateAbsent",False))

    def test_substituted_public_name_rejected(self):
        self.inventory["inventory"]["existingHandles"] += (HANDLE,)
        self.public["metadata"]["name"]="000b"+"c"*64
        self.assertFalse(self.call().get("publicShapeMatches",False))

    def test_substituted_policy_digest_rejected(self):
        self.inventory["inventory"]["existingHandles"] += (HANDLE,)
        self.public["metadata"]["authorization policy"]="c"*64
        self.assertFalse(self.call().get("publicShapeMatches",False))

    def test_malformed_size_type_and_missing_policy_rejected(self):
        self.inventory["inventory"]["existingHandles"] += (HANDLE,)
        for mutation in (
            lambda m: m.update({"size":8}),
            lambda m: m.update({"size":True}),
            lambda m: m["attributes"].update({"value":0x20060018}),
            lambda m: m["attributes"].update({"value":0x2006004A}),
            lambda m: m["attributes"].update({"value":0x20020048}),
            lambda m: m["attributes"].update({"friendly":"policywrite|nt=0x1|authread"}),
            lambda m: m["attributes"].update({"friendly":"ownerwrite|nt=0x4|authread"}),
            lambda m: m.pop("authorization policy"),
            lambda m: m.update({"extraUntrustedField":1}),
            lambda m: m["hash algorithm"].update({"friendly":"sha1"}),
        ):
            with self.subTest(mutation=mutation):
                self.public["metadata"]=deepcopy(PUBLIC)
                mutation(self.public["metadata"])
                self.assertFalse(self.call().get("publicShapeMatches",False))

    def test_duplicate_handle_inventory_denied(self):
        self.inventory["inventory"]["existingHandles"] += (HANDLE,HANDLE)
        self.assertFalse(self.call().get("publicShapeMatches",False))

    def test_wrong_handle_or_injection_denied(self):
        for handle in ("0x1880001; tpm2_clear","0x99999999","not-hex",
                       "0x18A1000","",None):
            with self.subTest(handle=handle):
                self.assertFalse(self.call(handle=handle).get("publicShapeMatches",False))

    def test_missing_inventory_and_fake_authorization_denied(self):
        for candidate in (None,{},{"status":"granted","inventoryObserved":True},
                          {**self.inventory,"authorizationGranted":True}):
            with self.subTest(candidate=candidate):
                self.assertFalse(self.call(inventory_result=candidate)
                                 .get("publicShapeMatches",False))

    def test_public_handle_mismatch_denied(self):
        self.inventory["inventory"]["existingHandles"] += (HANDLE,)
        self.public["handle"]="0x18a1001"
        self.assertFalse(self.call().get("publicShapeMatches",False))

    def test_absent_pins_or_enrollment_denied_for_present_index(self):
        self.inventory["inventory"]["existingHandles"] += (HANDLE,)
        for kwargs in ({"expected_name":None},{"expected_policy_digest":"x"*64},
                       {"enrollment_id":""},{"enrollment_id":"../../etc/shadow"}):
            with self.subTest(kwargs=kwargs):
                self.assertFalse(self.call(**kwargs).get("publicShapeMatches",False))

if __name__=="__main__":
    unittest.main()
