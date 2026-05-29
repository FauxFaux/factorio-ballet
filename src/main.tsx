import { render } from 'preact';
import './index.css';
import { UrlHandler } from './url-handler.tsx';

render(<UrlHandler />, document.getElementById('app')!);
