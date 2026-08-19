/**
 * ESM view of the v4 comparator.
 *
 * Same arrangement as paph3.js: the engine itself is a UMD file (`paph4.cjs`)
 * so a page can <script>-load it next to paph3.cjs; this wrapper gives ESM
 * consumers named exports without a second copy of the code.
 */
import m from './paph4.cjs';

export const COMPARATOR = m.COMPARATOR;
export const CONTAINER = m.CONTAINER;
export const sha256 = m.sha256;
export const hex = m.hex;
export const hashProfileId = m.hashProfileId;
export const assign = m.assign;
export const NO_EDGE = m.NO_EDGE;
export const shiftOffsets = m.shiftOffsets;
export const coverage = m.coverage;
export const lutEval = m.lutEval;
export const lutValidate = m.lutValidate;
export const profileEncode = m.profileEncode;
export const profileDecode = m.profileDecode;
export const profileValidate = m.profileValidate;
export const profileId = m.profileId;
export const profileIdHex16 = m.profileIdHex16;
export const profileName = m.profileName;
export const cal001 = m.cal001;
export const localV4 = m.localV4;
export const localV4Bags = m.localV4Bags;
export const conf = m.conf;
export const correspondW = m.correspondW;
export const extract = m.extract;
export const gnControl = m.gnControl;
export const topology = m.topology;
export const latticeV4 = m.latticeV4;
export const compareV4 = m.compareV4;
export const compareV41 = m.compareV41;
export const screenV41 = m.screenV41;
export const cal003 = m.cal003;
export const lutChannel = m.lutChannel;
export const assignSparse = m.assignSparse;
export const localV4_41 = m.localV4_41;
export const CONTAINER_V2 = m.CONTAINER_V2;
export const COMPARATOR_V41 = m.COMPARATOR_V41;
export const hashChecked = m.hashChecked;
export const MAX_WIDTH = m.MAX_WIDTH;
export const MAX_HEIGHT = m.MAX_HEIGHT;
export const MAX_PIXELS = m.MAX_PIXELS;
export default m;
