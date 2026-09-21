import { render } from 'preact';
import './index.css';
import { UrlHandler } from './boot/url-handler.tsx';

render(<UrlHandler />, document.getElementById('app')!);
