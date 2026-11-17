import { normalizeEspn } from "./espn/normalizer.js";
import { normalizeSleeper } from "./sleeper/normalizer.js";
/** The league model of a snapshot, by the platform its manifest names. */
export function normalizeSnapshot(snapshot) {
    return snapshot.manifest.platform === "espn"
        ? normalizeEspn(snapshot)
        : normalizeSleeper(snapshot);
}
//# sourceMappingURL=normalize.js.map