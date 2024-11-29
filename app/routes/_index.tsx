import type { MetaFunction } from '@remix-run/node';

export const meta: MetaFunction = () => {
  return [{ title: 'ballet' }];
};

export default function Index() {
  return (
    <div className="flex h-screen items-center justify-center">hello world</div>
  );
}
