export class ExemplarMatcher {
    db;
    constructor(db) {
        this.db = db;
    }
    async findSimilar(context, options = {}) {
        const threshold = options.threshold ?? 0.5;
        const topK = options.topK ?? 5;
        // Search using heuristic matching
        const results = await this.db.searchByEmbedding(new Float32Array(128), // Placeholder - would use actual embedding
        topK * 2, // Get more to filter
        threshold);
        // Re-score based on query context
        const scored = results.map(result => {
            const contextScore = this.calculateContextSimilarity(context, result.record);
            const combinedScore = (result.score + contextScore) / 2;
            return {
                record: result.record,
                score: combinedScore,
                matchedPatterns: this.findMatchedPatterns(context, result.record),
            };
        });
        return scored
            .filter(r => r.score >= threshold)
            .sort((a, b) => b.score - a.score)
            .slice(0, topK);
    }
    calculateContextSimilarity(query, record) {
        let score = 0;
        let weights = 0;
        // Task similarity (40%)
        const taskWords = query.task.toLowerCase().split(/\W+/);
        const recordWords = record.task.toLowerCase().split(/\W+/);
        const taskOverlap = taskWords.filter(w => recordWords.includes(w)).length;
        const taskSim = taskWords.length > 0
            ? taskOverlap / taskWords.length
            : 0;
        score += taskSim * 0.4;
        weights += 0.4;
        // File similarity (30%)
        const fileOverlap = query.files.filter(f => record.fileChanges.some(rf => rf.includes(f) || f.includes(rf))).length;
        const fileSim = query.files.length > 0
            ? fileOverlap / query.files.length
            : 0;
        score += fileSim * 0.3;
        weights += 0.3;
        // Error pattern similarity (30%)
        const errorMatches = query.errors.filter(err => record.errorSummary.toLowerCase().includes(err.toLowerCase())).length;
        const errorSim = query.errors.length > 0
            ? errorMatches / query.errors.length
            : 0;
        score += errorSim * 0.3;
        weights += 0.3;
        return weights > 0 ? score / weights : 0;
    }
    findMatchedPatterns(query, record) {
        const patterns = [];
        for (const error of query.errors) {
            if (record.errorSummary.toLowerCase().includes(error.toLowerCase())) {
                patterns.push(error);
            }
        }
        for (const file of query.files) {
            if (record.fileChanges.some(f => f.includes(file))) {
                patterns.push(`file:${file}`);
            }
        }
        return patterns;
    }
    async recordResolution(failureId, resolution) {
        const record = await this.db.getFailure(failureId);
        if (record) {
            await this.db.insertFailure({
                ...record,
                resolution,
                resolvedAt: Date.now(),
            });
        }
    }
}
