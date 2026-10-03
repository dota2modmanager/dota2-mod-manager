// The VPK format, in one place for everything that reads or writes one: the reader
// (src/vpk-read.ts), the writer (src/vpk-write.ts), packing a folder into one (src/vpk-pack.ts)
// and what a mod's paths say it changes (src/vpk-analyze.ts). Callers import from here; the four
// files are how it is kept readable.
export {
  readVpkIndexFile, listVpkPaths, listVpkPathsFile, listVpkPathCrcs, listVpkPathCrcsFile, readVpkEntryFile,
  openVpkIndex, entryPath, readVpkEntries, listVpkEntries, fingerprintEntries, fingerprintVpk, fingerprintFiles,
} from './vpk-read.ts';
export type { VpkEntry, VpkDirEntry, VpkIndex } from './vpk-read.ts';
export {
  analyzeVpkPaths, slotDisplayName, describeHero, subjectHeroes, describeAnalysis, nameFromAnalysis,
} from './vpk-analyze.ts';
export type { HeroHit, Analysis } from './vpk-analyze.ts';
export {
  crc32, entryAt, buildVpk, buildVpkDir, combineVpksToFiles, mergeVpkToSingle, splitVpkByHero,
} from './vpk-write.ts';
export { findContentRoot, packFolder } from './vpk-pack.ts';
// read from here by callers that name heroes and slots in one breath
export { heroDisplayName } from './hero-names.ts';
