import { createDataset } from '../src/dataset';

import { bobAngs } from '../src/dataset/catalogue/bobang.ts';

export const defaultDataset = createDataset('bobang-ju7', await bobAngs());
