"""Fixed OCI qualification-image bytes. No execution, extraction or admission.

The payload is opaque: a matching digest proves neither code safety nor source
provenance. This module performs no filesystem/process/network operations.
"""
from dataclasses import dataclass
from hashlib import sha256
import json
import re
from types import MappingProxyType

MAX_PROBE = 1024 * 1024
MAX_LAYER = MAX_PROBE + 7 * 512 + 1024
MAX_TOTAL = 2 * 1024 * 1024
MAX_METADATA = 16 * 1024
MANIFEST = "application/vnd.oci.image.manifest.v1+json"
INDEX = "application/vnd.oci.image.index.v1+json"
CONFIG = "application/vnd.oci.image.config.v1+json"
LAYER = "application/vnd.oci.image.layer.v1.tar"
_DIGEST = re.compile(r"sha256:[0-9a-f]{64}\Z")
_ENTRIES = (("dev", 0o755, b"5"), ("probe", 0o555, b"0"),
            ("proc", 0o755, b"5"), ("run", 0o755, b"5"),
            ("run/alix", 0o755, b"5"), ("tmp", 0o1777, b"5"),
            ("workspace", 0o755, b"5"))


@dataclass(frozen=True)
class QualificationImageReceipt:
    """Detached consistency facts only; no runtime or custody authority."""
    schema_version: int
    manifest_digest: str
    layer_digest: str
    probe_digest: str


@dataclass(frozen=True)
class QualificationImage:
    files: MappingProxyType
    receipt: QualificationImageReceipt


def _digest(data: bytes) -> str:
    return "sha256:" + sha256(data).hexdigest()


def _json(value: dict) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=True, allow_nan=False).encode("ascii")


def _octal(value: int, width: int) -> bytes:
    return format(value, "0" + str(width - 1) + "o").encode("ascii") + b"\0"


def _header(name: str, mode: int, size: int, kind: bytes) -> bytes:
    header = bytearray(512)
    encoded = name.encode("ascii")
    header[:len(encoded)] = encoded
    header[100:108] = _octal(mode, 8)
    header[108:116] = _octal(0, 8)
    header[116:124] = _octal(0, 8)
    header[124:136] = _octal(size, 12)
    header[136:148] = _octal(0, 12)
    header[148:156] = b" " * 8
    header[156:157] = kind
    header[257:263] = b"ustar\0"
    header[263:265] = b"00"
    header[148:156] = format(sum(header), "06o").encode("ascii") + b"\0 "
    return bytes(header)


def _layer(probe: bytes) -> bytes:
    parts = []
    for name, mode, kind in _ENTRIES:
        data = probe if name == "probe" else b""
        parts.append(_header(name, mode, len(data), kind))
        if data:
            parts.extend((data, b"\0" * (-len(data) % 512)))
    parts.append(b"\0" * 1024)
    return b"".join(parts)


def _probe_from_layer(layer: bytes) -> bytes:
    offset = 0
    probe = b""
    for name, mode, kind in _ENTRIES:
        if offset + 512 > len(layer):
            raise ValueError("Truncated qualification layer")
        header = layer[offset:offset + 512]
        offset += 512
        size = 0
        if name == "probe":
            field = header[124:136]
            if re.fullmatch(b"[0-7]{11}\0", field) is None:
                raise ValueError("Noncanonical probe size")
            size = int(field[:-1], 8)
            if not 1 <= size <= MAX_PROBE:
                raise ValueError("Probe size outside qualification bounds")
        if header != _header(name, mode, size, kind):
            raise ValueError("Unexpected qualification layer header")
        padded = size + (-size % 512)
        if offset + padded > len(layer):
            raise ValueError("Truncated probe bytes")
        if name == "probe":
            probe = layer[offset:offset + size]
        offset += padded
    if layer != _layer(probe):
        raise ValueError("Noncanonical padding or layer termination")
    return probe


def _descriptor(media: str, data: bytes) -> dict:
    return {"mediaType": media, "digest": _digest(data), "size": len(data)}


def build_qualification_image(probe: bytes) -> QualificationImage:
    """Package opaque pinned bytes; does not assess executable safety."""
    if type(probe) is not bytes or not 1 <= len(probe) <= MAX_PROBE:
        raise ValueError("Expected bounded immutable probe bytes")
    layer = _layer(probe)
    config = _json({
        "architecture": "amd64", "os": "linux", "created": "1970-01-01T00:00:00Z",
        "config": {"User": "20002:20002", "Entrypoint": ["/probe"],
                   "WorkingDir": "/workspace",
                   "Env": ["HOME=/nonexistent", "PATH=", "LANG=C"],
                   "Labels": {"org.alix.ge04.qualification-only": "true"}},
        "rootfs": {"type": "layers", "diff_ids": [_digest(layer)]},
    })
    manifest = _json({"schemaVersion": 2, "mediaType": MANIFEST,
                      "config": _descriptor(CONFIG, config),
                      "layers": [_descriptor(LAYER, layer)]})
    index = _json({"schemaVersion": 2, "mediaType": INDEX,
                   "manifests": [{**_descriptor(MANIFEST, manifest),
                                  "platform": {"architecture": "amd64", "os": "linux"}}]})
    files = {"oci-layout": _json({"imageLayoutVersion": "1.0.0"}), "index.json": index}
    for data in (config, layer, manifest):
        files["blobs/sha256/" + sha256(data).hexdigest()] = data
    receipt = QualificationImageReceipt(1, _digest(manifest), _digest(layer), _digest(probe))
    return QualificationImage(MappingProxyType(files), receipt)


def _reject_number(_value):
    raise ValueError("Noninteger JSON number")


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key")
        result[key] = value
    return result


def _decode(data: bytes) -> dict:
    if len(data) > MAX_METADATA:
        raise ValueError("Oversized qualification metadata")
    try:
        value = json.loads(data.decode("utf-8"), object_pairs_hook=_unique_object,
                           parse_float=_reject_number, parse_constant=_reject_number)
    except (ValueError, RecursionError) as error:
        raise ValueError("Invalid qualification metadata") from error
    if type(value) is not dict:
        raise ValueError("Expected metadata object")
    return value


def _follow(files: dict, descriptor: dict, media: str) -> bytes:
    if type(descriptor) is not dict or set(descriptor) != {"mediaType", "digest", "size"}:
        raise ValueError("Invalid qualification descriptor")
    digest = descriptor["digest"]
    size = descriptor["size"]
    bound = MAX_LAYER if media == LAYER else MAX_METADATA
    if (descriptor["mediaType"] != media or type(digest) is not str or
            _DIGEST.fullmatch(digest) is None or type(size) is not int or not 1 <= size <= bound):
        raise ValueError("Invalid qualification descriptor fields")
    data = files.get("blobs/sha256/" + digest[7:])
    if data is None or len(data) != size or _digest(data) != digest:
        raise ValueError("Missing or mismatched qualification blob")
    return data


def verify_qualification_image(files, expected_probe_digest: str) -> QualificationImageReceipt:
    """Verify fixed-format integrity against a caller pin; never admit code.

    Only an exact dict is accepted. Even mapping proxies can delegate to hostile
    mapping methods. A trusted caller may copy the builder's known private proxy.
    """
    if type(files) is not dict:
        raise ValueError("Expected exact inert dictionary")
    if (type(expected_probe_digest) is not str or
            _DIGEST.fullmatch(expected_probe_digest) is None or len(files) != 5):
        raise ValueError("Invalid qualification pin or inventory")
    snapshot = {}
    total = 0
    try:
        for key, value in files.items():
            if type(key) is not str or type(value) is not bytes or len(snapshot) >= 5:
                raise ValueError("Invalid qualification file types/count")
            if (key not in ("oci-layout", "index.json") and
                    (len(key) != 77 or re.fullmatch(r"blobs/sha256/[0-9a-f]{64}", key) is None)):
                raise ValueError("Invalid qualification file path")
            total += len(value)
            if total > MAX_TOTAL:
                raise ValueError("Oversized qualification image")
            snapshot[key] = value
    except RuntimeError as error:
        raise ValueError("Qualification inventory changed") from error
    if len(snapshot) != 5 or not {"oci-layout", "index.json"} <= snapshot.keys():
        raise ValueError("Missing qualification metadata")
    if _decode(snapshot["oci-layout"]) != {"imageLayoutVersion": "1.0.0"}:
        raise ValueError("Invalid qualification layout")
    index = _decode(snapshot["index.json"])
    manifests = index.get("manifests")
    if type(manifests) is not list or len(manifests) != 1 or type(manifests[0]) is not dict:
        raise ValueError("Invalid qualification manifest inventory")
    entry = manifests[0]
    if (set(entry) != {"mediaType", "digest", "size", "platform"} or
            entry["platform"] != {"architecture": "amd64", "os": "linux"}):
        raise ValueError("Invalid qualification platform")
    manifest = _decode(_follow(snapshot, {k: entry[k] for k in ("mediaType", "digest", "size")}, MANIFEST))
    layers = manifest.get("layers")
    if type(layers) is not list or len(layers) != 1:
        raise ValueError("Invalid qualification layer inventory")
    _decode(_follow(snapshot, manifest.get("config"), CONFIG))
    probe = _probe_from_layer(_follow(snapshot, layers[0], LAYER))
    if _digest(probe) != expected_probe_digest:
        raise ValueError("Probe does not match caller pin")
    expected = build_qualification_image(probe)
    if snapshot != dict(expected.files):
        raise ValueError("Image differs from fixed qualification format")
    return expected.receipt
