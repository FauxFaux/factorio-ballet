import { Component, type ComponentChildren, type ErrorInfo } from 'preact';
import { type ErrorObject, serializeError } from 'serialize-error';
import type { UrlState } from './url-handler.tsx';

interface CrashState {
  error?: unknown;
  errorInfo?: ErrorInfo;
}

export class CrashHandler extends Component<
  { children: ComponentChildren; us: UrlState },
  CrashState
> {
  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    this.setState({ error, errorInfo });
  }

  render(props: { children: ComponentChildren; us: UrlState }, state: CrashState) {
    if (!state.error) {
      return props.children;
    }

    const errors: ErrorObject[] = [];

    let here = serializeError(state.error);
    for (let i = 0; i < 10; i++) {
      errors.push(here);
      if (!here.cause) {
        break;
      }
      here = serializeError(here.cause);
    }

    return (
      <div style={{ color: 'red', minWidth: '800px' }}>
        <h1>Something went wrong</h1>
        <p>
          Try <a href={'/'}>clearing your state</a>?
        </p>
        {errors.map((err, i) => {
          const otherProps = { ...err };
          delete otherProps.name;
          delete otherProps.message;
          delete otherProps.stack;
          return (
            <div key={i}>
              <pre>{err.stack}</pre>
              <pre>
                {Object.keys(otherProps).length ? <pre>{JSON.stringify(otherProps)}</pre> : <></>}
              </pre>
            </div>
          );
        })}
        <h3>state</h3>
        <pre>{JSON.stringify(props.us, null, 2)}</pre>
      </div>
    );
  }
}
