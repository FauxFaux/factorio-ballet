import { createDataset } from '../src/dataset';

import { bobAngs } from '../src/dataset/catalogue/bobang.ts';

export const defaultDataset = createDataset('bobang-r4q', await bobAngs());
