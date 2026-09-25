import { render } from 'preact';
import './index.css';
import { DatasetBoot } from './boot/dataset-boot.tsx';

render(<DatasetBoot />, document.getElementById('app')!);
