import { isRouteErrorResponse, useRouteError } from 'react-router';
import { ButtonLink } from '@/components/ui';

/** Router-level error element: unknown routes and unexpected render errors. */
export function RouteError() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-sm font-semibold tracking-wide text-brand-300 uppercase">{notFound ? '404' : 'Error'}</p>
      <h1 className="text-2xl font-semibold text-white">{notFound ? 'Page not found' : 'Something went wrong'}</h1>
      <p className="max-w-md text-sm text-slate-400">
        {notFound ? 'The page you are looking for does not exist or has moved.' : 'An unexpected error occurred while showing this page. Reload, or go back to the start.'}
      </p>
      <ButtonLink to="/" variant="outline">
        Go to home
      </ButtonLink>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 px-6 py-24 text-center">
      <p className="text-sm font-semibold tracking-wide text-brand-300 uppercase">404</p>
      <h1 className="text-2xl font-semibold text-white">Page not found</h1>
      <p className="max-w-md text-sm text-slate-400">The page you are looking for does not exist or has moved.</p>
      <ButtonLink to="/app" variant="outline">
        Go to my dashboard
      </ButtonLink>
    </div>
  );
}
