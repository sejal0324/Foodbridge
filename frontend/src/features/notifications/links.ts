/** Only same-app relative paths are followed (the backend enforces this too). */
export function safeLinkPath(link: string | null | undefined): string | null {
  if (!link || !link.startsWith('/') || link.startsWith('//') || link.startsWith('/\\')) return null;
  return link;
}
