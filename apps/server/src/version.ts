import rootPackage from '../../../package.json' with { type: 'json' };

/** analyzr version: the `version` of the workspace root package.json (`0.1.0-alpha.N`). */
export const ANALYZR_VERSION: string = rootPackage.version;
