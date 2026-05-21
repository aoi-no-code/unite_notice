export const FRIEND_CODE_ISSUE_BUTTON_ID = 'friend:issue_code';

export function buildFriendCodeGuidePayload() {
  return {
    content:
      '**フレンド追加コードの使い方**\n\n' +
      '1. 下の **コードを発行** を押す\n' +
      '2. このあと Bot から届く **コードだけのメッセージ** を長押ししてコピー\n' +
      '3. 相手にコードを送る\n' +
      '4. 相手は Bot の DM で `/friend request` を実行し、コードを入力\n' +
      '5. 届いた申請を DM のボタンまたは `/friend pending` で承認\n\n' +
      '※コードは7日間有効です。必要なら何度でも再発行できます。',
    components: [
      {
        type: 1,
        components: [{ type: 2, style: 1, label: 'コードを発行', custom_id: FRIEND_CODE_ISSUE_BUTTON_ID }],
      },
    ],
  };
}
