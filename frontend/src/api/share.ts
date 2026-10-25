import client from './client';

export const shareApi = {
  createEntryLink: (entryId: string) =>
    client.post<{ token: string }>(`/share/entry/${entryId}`),
  // SEC-5: отозвать все активные share-ссылки записи разом
  revokeEntryLinks: (entryId: string) =>
    client.delete<{ revoked: number }>(`/share/entry/${entryId}`),
};
