"""Unprivileged format/integrity tests. Never execute or extract an image."""
from dataclasses import FrozenInstanceError
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tarfile
from types import MappingProxyType
import unittest

_SPEC = importlib.util.spec_from_file_location(
    "ge04_oci_image", Path(__file__).resolve().parents[2] / "native/ge04/oci_qualification_image.py")
image = importlib.util.module_from_spec(_SPEC)
sys.modules[_SPEC.name] = image
_SPEC.loader.exec_module(image)

PROBE = b"GE04 inert image fixture\n"  # Deliberately not executable machine code.
MANIFEST = "application/vnd.oci.image.manifest.v1+json"
INDEX = "application/vnd.oci.image.index.v1+json"
CONFIG = "application/vnd.oci.image.config.v1+json"
LAYER = "application/vnd.oci.image.layer.v1.tar"


def digest(data):
    return "sha256:" + hashlib.sha256(data).hexdigest()


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def descriptor(media, data):
    return {"mediaType": media, "digest": digest(data), "size": len(data)}


def blob(files, desc):
    return files["blobs/sha256/" + desc["digest"][7:]]


def parts(files):
    index = json.loads(files["index.json"])
    manifest = json.loads(blob(files, index["manifests"][0]))
    return blob(files, manifest["config"]), blob(files, manifest["layers"][0])


def repack(files, config=None, layer=None, mutate_manifest=None, mutate_index=None):
    """Independent test writer rehashes attacks through the whole blob graph."""
    old_config, old_layer = parts(files)
    if config is None:
        config = old_config
        if layer is not None:
            value = json.loads(config)
            value["rootfs"]["diff_ids"] = [digest(layer)]
            config = encode(value)
    if layer is None:
        layer = old_layer
    manifest = {"schemaVersion": 2, "mediaType": MANIFEST,
                "config": descriptor(CONFIG, config), "layers": [descriptor(LAYER, layer)]}
    if mutate_manifest:
        mutate_manifest(manifest)
    manifest_bytes = encode(manifest)
    index = {"schemaVersion": 2, "mediaType": INDEX,
             "manifests": [{**descriptor(MANIFEST, manifest_bytes),
                            "platform": {"architecture": "amd64", "os": "linux"}}]}
    if mutate_index:
        mutate_index(index)
    result = {"oci-layout": files["oci-layout"], "index.json": encode(index)}
    for data in (config, layer, manifest_bytes):
        result["blobs/sha256/" + digest(data)[7:]] = data
    return result


def change_header(layer, offset, start, value, checksum=True):
    result = bytearray(layer)
    result[offset + start:offset + start + len(value)] = value
    if checksum:
        result[offset + 148:offset + 156] = b" " * 8
        result[offset + 148:offset + 156] = (
            f"{sum(result[offset:offset + 512]):06o}".encode() + b"\0 ")
    return bytes(result)


class QualificationImageTests(unittest.TestCase):
    def setUp(self):
        self.built = image.build_qualification_image(PROBE)
        self.files = dict(self.built.files)  # Known builder proxy, trusted copy.
        self.pin = digest(PROBE)

    def reject(self, files, pin=None):
        with self.assertRaises(ValueError):
            image.verify_qualification_image(files, self.pin if pin is None else pin)

    def test_golden_and_determinism(self):
        # Independently derived with stdlib TarInfo USTAR headers, canonicalized
        # per the documented unused-field/name rules, then hashlib/JSON graph.
        self.assertEqual(self.built.receipt.manifest_digest,
                         "sha256:5c5bdbac2f073c900785aecfce6c52e48c1a15c374174c5e3a905e0521b651ab")
        self.assertEqual(self.built.receipt.layer_digest,
                         "sha256:430b3cc95a6e1e50068b79a75b32a75ca84742cdddde9fc72081899170159ef9")
        self.assertEqual(self.files, dict(image.build_qualification_image(PROBE).files))
        self.assertNotEqual(self.built.receipt, image.build_qualification_image(PROBE + b"x").receipt)

    def test_independent_oci_graph_and_tar_oracle(self):
        index = json.loads(self.files["index.json"])
        manifest_bytes = blob(self.files, index["manifests"][0])
        manifest = json.loads(manifest_bytes)
        config_bytes, layer = parts(self.files)
        for desc, content in [(index["manifests"][0], manifest_bytes),
                              (manifest["config"], config_bytes), (manifest["layers"][0], layer)]:
            self.assertEqual(desc["size"], len(content))
            self.assertEqual(desc["digest"], digest(content))
        self.assertEqual(json.loads(config_bytes)["rootfs"]["diff_ids"], [digest(layer)])
        with tarfile.open(fileobj=io.BytesIO(layer), mode="r:") as archive:
            members = archive.getmembers()
            self.assertEqual([m.name for m in members],
                             ["dev", "probe", "proc", "run", "run/alix", "tmp", "workspace"])
            for member in members:
                self.assertEqual((member.uid, member.gid, member.mtime), (0, 0, 0))
                self.assertEqual(member.mode, 0o555 if member.name == "probe" else
                                 0o1777 if member.name == "tmp" else 0o755)
                self.assertEqual(member.isfile(), member.name == "probe")
                self.assertEqual(member.isdir(), member.name != "probe")
            self.assertEqual(archive.extractfile("probe").read(), PROBE)

    def test_inert_payload_is_integrity_only(self):
        self.assertFalse(PROBE.startswith(b"\x7fELF"))
        self.assertEqual(image.verify_qualification_image(self.files, self.pin), self.built.receipt)

    def test_payload_boundaries(self):
        for payload in (b"x", b"x" * (1024 * 1024)):
            with self.subTest(size=len(payload)):
                result = image.build_qualification_image(payload)
                self.assertEqual(image.verify_qualification_image(dict(result.files), digest(payload)), result.receipt)
        _, maximum = parts(dict(image.build_qualification_image(b"x" * (1024 * 1024)).files))
        self.assertEqual(len(maximum), 1053184)

    def test_reject_mutable_empty_oversized_or_subclass_payload(self):
        class BytesSubclass(bytes):
            pass
        for value in (b"", b"x" * (1024 * 1024 + 1), bytearray(b"x"), memoryview(b"x"),
                      "x", None, BytesSubclass(b"x")):
            with self.subTest(kind=type(value)):
                with self.assertRaises(ValueError):
                    image.build_qualification_image(value)

    def test_output_frozen_and_receipt_detached(self):
        receipt = image.verify_qualification_image(self.files, self.pin)
        self.files.clear()
        self.assertEqual(receipt, self.built.receipt)
        with self.assertRaises(TypeError):
            self.built.files["index.json"] = b"changed"
        with self.assertRaises(FrozenInstanceError):
            receipt.probe_digest = "changed"
        with self.assertRaises(FrozenInstanceError):
            self.built.files = {}

    def test_mapping_methods_never_invoked(self):
        class Hostile:
            def __len__(self):
                raise AssertionError("untrusted len invoked")
            def __getitem__(self, _key):
                raise AssertionError("untrusted lookup invoked")
            def keys(self):
                raise AssertionError("untrusted keys invoked")
        class DictSubclass(dict):
            def __len__(self):
                raise AssertionError("subclass len invoked")
            def items(self):
                raise AssertionError("subclass items invoked")
        for value in (Hostile(), MappingProxyType(Hostile()), self.built.files, DictSubclass(self.files)):
            self.reject(value)

    def test_invalid_pins_and_file_types(self):
        class StringSubclass(str):
            pass
        for pin in (None, self.pin.upper(), self.pin + "\n", "sha256:" + "../" * 22,
                    StringSubclass(self.pin), 1):
            self.reject(self.files, pin=pin if pin is not None else "")
        for replacement in (bytearray(b"{}"), memoryview(b"{}"), "{}", None):
            files = dict(self.files)
            files["oci-layout"] = replacement
            self.reject(files)
        files = dict(self.files)
        files[StringSubclass("oci-layout")] = files.pop("oci-layout")
        self.reject(files)

    def test_inventory_and_total_bounds(self):
        for operation in (lambda f: f.pop("oci-layout"), lambda f: f.update({"extra": b"x"}),
                          lambda f: f.update({"oci-layout": b"x" * (2 * 1024 * 1024 + 1)})):
            files = dict(self.files)
            operation(files)
            self.reject(files)

    def test_invalid_metadata(self):
        for data in (b"\xff", b"{", b"[]", b"null", b'{"imageLayoutVersion":"1.0.0","imageLayoutVersion":"1.0.0"}',
                     b"{" + b" " * 16384 + b"}", b'{"n":NaN}', b'{"n":1.2}',
                     b"[" * 2000 + b"]" * 2000):
            files = dict(self.files)
            files["oci-layout"] = data
            self.reject(files)
        files = dict(self.files)
        files["index.json"] = b'{"manifests":[],"manifests":[]}'
        self.reject(files)

    def test_noncanonical_json_and_unknown_metadata(self):
        for key, data in (("oci-layout", b'{ "imageLayoutVersion": "1.0.0" }'),
                          ("oci-layout", b'{"imageLayoutVersion":"1.0.0","extra":true}'),
                          ("index.json", json.dumps(json.loads(self.files["index.json"]), indent=2).encode())):
            files = dict(self.files)
            files[key] = data
            self.reject(files)

    def test_rehashed_image_config_changes(self):
        original, _ = parts(self.files)
        changes = [("User", "0:0"), ("Env", ["API_KEY=synthetic"]),
                   ("Entrypoint", ["/bin/sh"]), ("WorkingDir", "/"),
                   ("Labels", {}), ("Cmd", ["override"])]
        for key, value in changes:
            with self.subTest(field=key):
                config = json.loads(original)
                config["config"][key] = value
                self.reject(repack(self.files, config=encode(config)))

    def test_rehashed_manifest_and_platform_changes(self):
        for key, value in (("schemaVersion", True), ("schemaVersion", 3), ("mediaType", "other"), ("extra", "x")):
            self.reject(repack(self.files, mutate_manifest=lambda m: m.update({key: value})))
        self.reject(repack(self.files, mutate_index=lambda i: i["manifests"][0].update(
            {"platform": {"architecture": "arm64", "os": "linux"}})))
        self.reject(repack(self.files, mutate_index=lambda i: i.update({"extra": "x"})))

    def test_descriptor_types_sizes_media_and_paths(self):
        changes = [("size", True), ("size", -1), ("size", 1.0), ("size", "1"),
                   ("size", 2 ** 64), ("mediaType", "unknown"), ("digest", "sha256:" + "F" * 64),
                   ("digest", "sha256:../../escape"), ("digest", "sha256:" + "0" * 64),
                   ("urls", ["https://invalid.example/"])]
        for key, value in changes:
            with self.subTest(field=key, value=value):
                self.reject(repack(self.files, mutate_manifest=lambda m: m["layers"][0].update({key: value})))
        self.reject(repack(self.files, mutate_manifest=lambda m: m.update({"layers": []})))
        self.reject(repack(self.files, mutate_manifest=lambda m: m.update({"config": None})))

    def test_raw_blob_corruption_and_missing_reference(self):
        for path in self.files:
            if path.startswith("blobs/"):
                files = dict(self.files)
                files[path] = files[path] + b"x"
                self.reject(files)
                files = dict(self.files)
                files[path + "0"] = files.pop(path)
                self.reject(files)

    def test_rehashed_unsafe_archive_names_types_and_metadata(self):
        _, layer = parts(self.files)
        mutations = [(0, 0, name.ljust(100, b"\0")) for name in (b"../escape", b"/absolute", b"probe")]
        mutations += [(512, 156, kind) for kind in (b"1", b"2", b"3", b"4", b"6", b"x", b"g", b"S", b"L")]
        mutations += [(512, 157, b"../../outside"), (512, 100, b"0000777\0"),
                      (512, 108, b"0000001\0"), (512, 136, b"00000000001\0"),
                      (0, 124, b"00000000001\0"), (512, 124, b"00000000000\0"),
                      (512, 124, b"00004000001\0"), (512, 124, b"\x80" + b"\0" * 11),
                      (512, 257, b"notar!")]
        for offset, start, value in mutations:
            with self.subTest(offset=offset, field=start, value=value):
                altered = change_header(layer, offset, start, value)
                self.reject(repack(self.files, layer=altered))

    def test_rehashed_archive_checksum_padding_truncation_and_trailing_data(self):
        _, layer = parts(self.files)
        mutations = [change_header(layer, 0, 148, b"000000\0 ", checksum=False),
                     layer[:1024 + len(PROBE)] + b"x" + layer[1025 + len(PROBE):],
                     layer[:-1], layer[:1000], layer + b"x", layer + bytes(512),
                     layer[:-1024] + b"x" + layer[-1023:]]
        for altered in mutations:
            self.reject(repack(self.files, layer=altered))

    def test_self_consistent_changed_probe_cannot_replace_caller_pin(self):
        changed = dict(image.build_qualification_image(PROBE + b"x").files)
        self.reject(changed)
        self.assertEqual(image.verify_qualification_image(changed, digest(PROBE + b"x")).probe_digest,
                         digest(PROBE + b"x"))


if __name__ == "__main__":
    unittest.main()
