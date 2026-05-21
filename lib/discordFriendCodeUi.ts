const FRIEND_CODE_RE = /^[A-F0-9]{8}$/;

export function isFriendCode(value: string): boolean {
  return FRIEND_CODE_RE.test(value.trim().toUpperCase());
}

export function buildFriendCodeCopyUrl(code: string): string | null {
  const base = process.env.APP_BASE_URL?.replace(/\/$/, '');
  if (!base) return null;
  return `${base}/copy?c=${encodeURIComponent(code)}`;
}

export function buildFriendCodeIssuePayload(code: string, expiresAt: string) {
  const expires = new Date(expiresAt).toLocaleString('ja-JP');
  const copyUrl = buildFriendCodeCopyUrl(code);
  const rowComponents: unknown[] = [];
  if (copyUrl) {
    rowComponents.push({ type: 2, style: 5, label: '📋 コードをコピー', url: copyUrl });
  }
  rowComponents.push({ type: 2, style: 2, label: '📋 DM内で表示', custom_id: `friend:copy:${code}` });

  return {
    content:
      `フレンド追加用コードを発行しました（7日間有効・${expires}まで）。\n\n` +
      '**📋 コードをコピー** をタップするとクリップボードにコピーできます。\n' +
      '相手には Bot の DM で `/friend request` を実行してもらってください。',
    embeds: [
      {
        title: 'フレンド追加コード',
        description: `\`\`\`\n${code}\n\`\`\``,
        color: 0x5865f2,
      },
    ],
    components: [{ type: 1, components: rowComponents }],
  };
}

export function buildFriendCodeCopyEphemeral(code: string) {
  return {
    content:
      '**タップしてコピー**（コードブロック右上の 📋 でもコピーできます）\n\n' + `\`\`\`\n${code}\n\`\`\``,
  };
}
