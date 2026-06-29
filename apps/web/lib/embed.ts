export function isEmbedSearchParam(
  search: string | URLSearchParams | null | undefined,
): boolean {
  if (!search) return false;
  const params =
    typeof search === 'string' ? new URLSearchParams(search) : search;
  return params.get('embed') === '1';
}

export function appendEmbedQuery(path: string, embed = false): string {
  if (!embed) return path;

  const hashIndex = path.indexOf('#');
  const hash = hashIndex >= 0 ? path.slice(hashIndex) : '';
  const withoutHash = hashIndex >= 0 ? path.slice(0, hashIndex) : path;
  const [pathname, search = ''] = withoutHash.split('?');
  const params = new URLSearchParams(search);
  params.set('embed', '1');
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ''}${hash}`;
}
