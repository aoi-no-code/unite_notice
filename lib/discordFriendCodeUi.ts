import { COPY } from './botCopy';

export const FRIEND_CODE_ISSUE_BUTTON_ID = 'friend:issue_code';

export function buildFriendCodeGuidePayload() {
  return {
    content: COPY.friend.codeGuide,
    components: [
      {
        type: 1,
        components: [{ type: 2, style: 1, label: COPY.friend.issueCodeBtn, custom_id: FRIEND_CODE_ISSUE_BUTTON_ID }],
      },
    ],
  };
}
