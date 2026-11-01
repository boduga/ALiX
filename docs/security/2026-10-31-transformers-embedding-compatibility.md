# Transformers embedding compatibility — offline preflight

Date: 2026-10-31
Branch: `test/transformers-embedding-compatibility`
Status: **HOLD — real embedding model absent from isolated cache**

## Evidence

- Reused the successful disposable `@huggingface/transformers@4.3.2` installation (installed with lifecycle scripts disabled).
- Requested `pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {device:'cpu', local_files_only:true})` with `env.allowRemoteModels=false`.
- The runtime correctly failed closed because the local model directory lacked `Xenova/all-MiniLM-L6-v2/config.json`. No remote model download was allowed.
- The user's pre-existing Hugging Face cache contains a `sentence-transformers/all-MiniLM-L6-v2` snapshot with tokenizer and safetensors weights, **not an ONNX artifact**. This is not equivalent to the model ID or ONNX packaging expected by the JavaScript runtime; no substitution was made.
- The previous isolated ONNX Identity-model CPU inference passed, but it does not validate feature extraction, pooling, normalization, 384-dimensional embedding shape, or ALiX cache compatibility.

## Acceptance conditions

1. Choose a pinned reviewed model revision compatible with Transformers.js 4.3.2 and obtain its ONNX files and tokenizer/config from a trusted source. Record exact revision, file hashes, and licensing/provenance.
2. Stage the model in a disposable local model directory; keep `allowRemoteModels=false` and disable install scripts.
3. Compare old/new model outputs for the same input texts, including vector dimension, cosine similarity and ranking. Treat any embedding representation change as a cache-version migration.
4. Test `EmbeddingCache` lazy loading, cache keys, failed-model initialization, and batch search alignment. Existing code indexes embeddings using original batch offsets after filtering out contentless files, which deserves a separate regression test and fix.
5. Audit the candidate package graph and obtain independent review before changing production dependencies or expired exception records.

No model was downloaded and no repository dependency, security policy or source code was changed. **D9 security closeout remains HOLD.**
