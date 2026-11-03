let owner = 'anonymous';
export const getSessionScope = () => owner;
export function setSessionScope(id: string | null) { owner = id || 'anonymous'; }
