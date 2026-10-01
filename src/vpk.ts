// The VPK format, in one place for everything that reads or writes one: the reader
// (src/vpk-read.ts), the writer (src/vpk-write.ts) and what a mod's paths say it changes
// (src/vpk-analyze.ts). Callers import from here; the three files are how it is kept readable.
export {
  readVpkIndexFile, listVpkPaths, listVpkPathsFile, listVpkPathCrcs, listVpkPathCrcsFile, readVpkEntryFile,
  openVpkIndex, entryPath, readVpkEntries, listVpkEntries, fingerprintEntries, fingerprintVpk, fingerprintFiles,
} from './vpk-read.ts';
export type { VpkEntry, VpkDirEntry, VpkIndex } from './vpk-read.ts';
export {
  analyzeVpkPaths, analyzeVpk, slotDisplayName, describeHero, subjectHeroes, describeAnalysis, nameFromAnalysis,
} from './vpk-analyze.ts';
export type { HeroHit, Analysis } from './vpk-analyze.ts';
export {
  crc32, entryAt, buildVpk, findContentRoot, packFolder, buildVpkDir, combineVpksToFiles, mergeVpkToSingle, splitVpkByHero,
} from './vpk-write.ts';
// read from here by callers that name heroes and slots in one breath
export { heroDisplayName } from './hero-names.ts';
