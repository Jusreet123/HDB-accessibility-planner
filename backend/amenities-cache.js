
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ENTRIES = 500;

const cache = new Map();

function getCachedAmenities(blockId, radius) {
    const key = `${blockId}:${radius}`;
    const entry = cache.get(key);

    if (!entry) {
        return null;
    }

    if (Date.now() >= entry.expiresAt) {
        cache.delete(key);
        return null;
    }

    return entry.data;
}

function setCachedAmenities(blockId, radius, data) {
    const key = `${blockId}:${radius}`;

    // Refresh the key's insertion order
    cache.delete(key);

    // Keep memory usage bounded
    if (cache.size >= MAX_ENTRIES) {
        const oldestKey = cache.keys().next().value;
        cache.delete(oldestKey);
    }

    cache.set(key, {
        data,
        expiresAt: Date.now() + CACHE_TTL_MS
    });
}

module.exports = {
    getCachedAmenities,
    setCachedAmenities
};