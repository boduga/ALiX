export class EmbeddingScorer {
    config;
    dimensions;
    modelName;
    constructor(config) {
        this.config = config;
        if (config.dimensions <= 0) {
            throw new Error("dimensions must be positive");
        }
        this.dimensions = config.dimensions;
        this.modelName = config.modelName;
    }
    async createEmbedding(context) {
        // Generate deterministic embedding based on context
        // In production, use actual embedding model (e.g., Nomic, SigLIP)
        const embedding = new Float32Array(this.dimensions);
        // Hash-based seeding for determinism
        let seed = this.hashString(context.taskType);
        for (const file of context.files) {
            seed ^= this.hashString(file);
        }
        // Fill embedding with pseudo-random values based on seed
        for (let i = 0; i < this.dimensions; i++) {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            embedding[i] = (seed % 1000) / 1000;
        }
        // Normalize
        const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
        for (let i = 0; i < this.dimensions; i++) {
            embedding[i] /= norm;
        }
        return embedding;
    }
    cosineSimilarity(a, b) {
        if (a.length !== b.length)
            return 0;
        let dot = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
        }
        return dot;
    }
    async scoreVerification(context) {
        // Factor-based scoring inspired by ClipCannon's multi-embedder approach
        const fileComplexity = Math.min(context.files.length / 10, 1);
        const errorDensity = context.errors.length > 0
            ? Math.min(context.errors.length / 5, 1)
            : 0.5;
        const toolDiversity = Math.min(context.tools.length / 8, 1);
        // Base score from weighted factors:
        // - fileComplexity (0.2): less complex = higher confidence
        // - errorDensity (0.3): fewer errors = higher confidence
        // - toolDiversity (0.2): more tools used = more signal
        // - base (0.3): baseline confidence when other signals are absent
        const baseScore = ((1 - fileComplexity) * 0.2 + // Less complex = higher confidence
            (1 - errorDensity) * 0.3 + // Fewer errors = higher confidence
            toolDiversity * 0.2 + // More tools used = more signal
            0.3 // Base confidence
        );
        return {
            score: Math.max(0, Math.min(1, baseScore)),
            factors: {
                fileComplexity,
                errorDensity,
                toolDiversity,
                historicalConfidence: 0.5, // TODO: Integrate with ExemplarMatcher
            },
        };
    }
    async createVerificationEmbedding(sessionId, taskType, context) {
        const embedding = await this.createEmbedding(context);
        return {
            id: `emb-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            sessionId,
            taskType,
            filePatterns: context.files,
            errorPatterns: context.errors,
            toolSequence: context.tools,
            embedding,
            createdAt: Date.now(),
        };
    }
    hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
        }
        return Math.abs(hash);
    }
}
//# sourceMappingURL=scorer.js.map