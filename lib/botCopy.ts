/** Bot（おばけ）の口調で統一したユーザー向け文言 */

/** 課金・プレミアム機能を有効にするまで false */
export const BILLING_FEATURE_ENABLED = false;

/** 現在有効な友達枠（課金未公開時は無料上限のみ） */
export const ACTIVE_FRIEND_SLOT_LIMIT = 3;

export const COPY = {
  billing: {
    wip:
      '👻 プレミアム・課金はまだ開発中だよ…\n' +
      'もう少し待っててほしいだｷﾞｬｰｽ🙏\n\n' +
      '今は友達は **3人まで** 遊べるよ✨',
  },
  setup: {
    embedTitle: '👻 呼んでくれてありがとだｷﾞｬｰｽ',
    embedDescription:
      'ﾎﾞｸを呼んでくれてありがとだｷﾞｬｰｽ👻\n\n' +
      '友達と遊びたい時のお手伝いをするﾖ！\n' +
      '必要な時はいつでも言ってﾈ✨\n\n' +
      '使い方を説明するﾖ！！\n' +
      '1. BotとのDMを開く\n' +
      '2. /register でゲーム内IDを登録\n' +
      '3. /friend code でフレンド追加用コードを発行\n' +
      '4. 相手に /friend request コード で申請してもらう\n' +
      '5. 届いた申請を承認（DMのボタンまたは /friend pending）\n' +
      '6. /play で今誘えそうなフレンドを検索\n\n' +
      'みんなも下から設定してみて欲しいだｷﾞｬｰｽ😈',
    dmButtonLabel: 'ﾎﾞｸとのDMを開く',
    dmWelcome:
      'ﾎﾞｸとのDM、開いてくれてありがとだｷﾞｬｰｽ👻\n\n' +
      'まずは `/register ゲーム内ID` で登録してね✨\n\n' +
      '友達追加したい時は…\n' +
      '1. `/friend code` でコード発行\n' +
      '2. 相手に `/friend request コード` してもらう\n' +
      '3. 届いた申請を承認（ボタン or `/friend pending`）\n\n' +
      '遊びたい時は `/play` だﾖ！',
    dmSentOk: 'DMしたﾖ！`/register` から始めてね✨',
    dmSentNg: 'DM送れなかった… Discordの設定でﾎﾞｸからのDMを許可してほしいだｷﾞｬｰｽ👻',
    guildOnly: '/setup はサーバー内で実行してね！',
    adminOnly: 'このコマンドは管理者だけだよ…',
  },

  register: {
    prompt:
      'ﾎﾞｸとのDM来てくれたんだね！ありがとだｷﾞｬｰｽ👻\n\n' +
      'まずゲーム内IDを教えてね✨\n\n' +
      '`/register ゲーム内ID`\n\n' +
      '登録したら `/play` で友達の最新対戦が表示されるﾖ！',
    dmOnly: '`/register` はﾎﾞｸとのDM専用だよ。サーバーでは `/setup` を見てね！',
    success: (unitePlayerId: string, profileLine: string) =>
      `登録できたよだｷﾞｬｰｽ✨\nゲーム内ID: ${unitePlayerId}\n${profileLine}\n\n次は \`/play\` してみてね！`,
    profileOk: (name: string) => `ゲーム内名: ${name}`,
    profileOkFallback: 'ゲーム内名: 取得できなかった（IDだけ保存したよ）',
    profileNotIndexed:
      'ゲーム内名: このIDは UniteAPI にまだいないみたい… uniteapi.dev で開けるか、IDを再確認してね（非公開だと取れないこともあるよ）',
    profileNameNotFound: 'ゲーム内名: UniteAPIで名前が取れなかった… IDの形式を確認してね',
    profileFetchFailed: 'ゲーム内名: 取得失敗（UniteAPIに繋がらなかった）',
    profileFailed: 'ゲーム内名: 取得失敗（IDだけ保存したよ）',
    noGuild: '参加してるサーバーが見つからない… 先にサーバー内でﾎﾞｸのコマンドを1回実行してね！',
    error: '登録中にエラーが出ちゃった… 少し待ってからもう一回試してね',
    missingInfo: '登録情報が足りないみたい… もう一回やってみて',
    responseMissing: '登録の返信が作れなかった… もう一回試してね',
  },

  notify: {
    dmOnly: '/notify はﾎﾞｸとのDM専用だよ！',
    invalidMode: '`/notify on` か `/notify off` を指定してね',
    noGuild: '対象サーバーが見つからない…',
    updated: (mode: string) =>
      mode === 'on'
        ? '通知 ON にしたよ！友達が動いてたらﾎﾞｸから連絡するね✨'
        : '通知 OFF にしたよ。また必要になったら `/notify on` だよ',
    pingDone: 'チェックしたよ！動いてる友達がいたらDMするね👻',
  },

  play: {
    dmOnly: '/play はﾎﾞｸとのDM専用だよ！',
    notRegistered: 'まだ登録してないみたい… 先に `/register` してね！',
    responseMissing: 'プレイ検索の返信が作れなかった… もう一回試してね',
    fetchError: 'プレイ状況の取得に失敗した… 少し待ってからもう一回ね',
    listHeader: '**友達の最近の対戦**（登録してる友達だけだよ）',
    embedTitle: '👻 /play',
    noFriends: 'まだ友達いないみたい… `/friend code` で追加してね！',
    inviteButton: (name: string) => `誘う: ${name}`,
    inviteAll: 'みんな誘う',
    close: '閉じる',
    inviteDm: (name: string) => `👻 **${name}** さんが\n一緒にやろだって👻!`,
    inviteSent: (name: string) => `**${name}** に誘ってみたよだｷﾞｬｰｽ✨`,
    inviteAllSent: (names: string, failLine: string) => `**${names}** に誘ってみたよだｷﾞｬｰｽ✨${failLine}`,
    inviteAllNone: (failLine: string) => `誘えた人がいなかった…${failLine}`,
    inviteAllFailSuffix: (names: string) => `\n\n誘えなかった人: ${names}`,
    noInviteTargets: '誘える友達がいないみたい…',
    notFriend: '友達じゃない人には誘えないよ',
    inviteFailed: '招待送れなかった… 相手のDM設定を確認してね',
    inviteAllError: '一括招待でエラーが出ちゃった…',
    inviteResponseMissing: '招待の返信が作れなかった… もう一回試してね',
    inviteAllResponseMissing: '一括招待の返信が作れなかった… もう一回試してね',
    invalidTarget: '招待先がおかしいみたい…',
    replyFailed: '返信の処理に失敗した…',
    replyNotify: (name: string, message: string) => `👻 **${name}** さん: ${message}`,
    menuClosed: 'このメニュー閉じたよ。また `/play` で開いてね',
    statusUnregistered: '未登録',
    statusNoHistory: '対戦履歴なし',
    reply1: 'インするね！',
    reply2: '次やろ！',
    reply3: 'ちょっと待ってね、色々あってまたやろ！',
    replyBtn3: 'また今度やろ',
  },

  ping: {
    active: (label: string, ts: number) =>
      `今やろう？ **${label}** さんが動いてるかもだｷﾞｬｰｽ👻（最新: <t:${ts}:R>）`,
  },

  friend: {
    dmOnly: '/friend はﾎﾞｸとのDM専用だよ！',
    codeGuide:
      '**友達追加コードの使い方**だよ👻\n\n' +
      '1. 下の **コードを発行** を押す\n' +
      '2. ﾎﾞｸから届く **コードだけのメッセージ** を長押ししてコピー\n' +
      '3. 相手にコードを送る\n' +
      '4. 相手は ﾎﾞｸのDMで `/friend request` してコード入力\n' +
      '5. 届いた申請をDMのボタンか `/friend pending` で承認\n\n' +
      '※コードは7日間有効。何度でも再発行できるよ✨',
    issueCodeBtn: 'コードを発行',
    codeDmFailed: 'コード送れなかった… DMを許可してほしいだｷﾞｬｰｽ👻',
    requestNeedCode: 'code を指定してね',
    requestResponseMissing: '申請の返信が作れなかった… もう一回試してね',
    requestDmToOwner: (displayName: string) =>
      `👻 **友達申請**が届いたよ！\n${displayName} さんから申請があるよ`,
    requestSentOk: '申請送ったよ！相手が承認したら友達になれるよ✨',
    requestDmFailed:
      '申請は登録したけど相手にDM送れなかった… 相手に `/friend pending` してもらってね',
    requestError: '申請中にエラーが出ちゃった… 少し待ってからもう一回ね',
    approveBtn: '承認',
    rejectBtn: '拒否',
    approvedDmToRequester: '👻 友達申請、**承認**されたよ！`/play` で状況見てね✨',
    approvedOk: (count: number, lines: string) =>
      `承認したよだｷﾞｬｰｽ✨\n\n**友達一覧**（${count}人）\n${lines}`,
    rejectedDmToRequester: '👻 友達申請は今回は通らなかったみたい…',
    rejectedOk: '申請を拒否したよ',
    rejectFailed: '拒否できなかった… もう処理済みかも',
    rejectError: '拒否中にエラーが出ちゃった…',
    approveResponseMissing: '承認の返信が作れなかった… もう一回試してね',
    rejectResponseMissing: '拒否の返信が作れなかった… もう一回試してね',
    approveError: '承認中にエラーが出ちゃった…',
    listHeader: (n: number) => `**友達一覧**（${n}人）`,
    listEmpty: 'まだ友達いないみたい…',
    pendingEmpty: '保留中の申請はないよ',
    pendingHeader: (n: number) => `**保留中の申請**（${n}件）`,
    manageEmpty: '友達いないよ… `/friend code` で追加してね',
    manageHeader: '**友達整理** — 外したい人のボタンを押してね',
    manageEmbedTitle: (n: number) => `友達一覧（${n}人）`,
    removeBtn: (label: string) => `外す: ${label}`,
    removed: (name: string) => `**${name}** を友達から外したよ`,
    removeSelf: '自分は外せないよ…',
    removeNotFriend: 'この人は友達じゃないみたい',
    removeFailed: '削除できなかった…',
    removeInvalid: '削除対象がおかしいみたい…',
    unknownSub: 'その /friend はまだ対応してない… code / request / list / manage / pending を使ってね',
    requesterFallback: '申請者',
    errors: {
      invalid_code: 'コードが見つからない… 8文字の英数字だよ',
      expired: 'コードの期限切れだよ。相手に `/friend code` で再発行してもらってね',
      self: '自分のコードには申請できないよ',
      already_friends: 'もう友達だよ！',
      already_pending: '同じ人への申請が保留中だよ',
      owner_not_registered: 'コードの人がまだ `/register` してないみたい',
      requester_not_registered: '先に `/register` でゲーム内IDを登録してね',
      request_failed: '申請できなかった…',
      approve_not_found: '申請が見つからない…',
      approve_not_owner: 'この申請を承認する権限がないよ',
      approve_not_pending: 'もう処理済みの申請だよ',
      approve_already_friends: 'もう友達だよ！',
      approve_limit: (max: number) =>
        `友達枠いっぱいだよ（今は${max}人まで）。外したい人がいたら \`/friend manage\` で整理してね`,
      approve_failed: '承認できなかった…',
    },
  },

  plan: {
    dmOnly: '/plan はﾎﾞｸとのDM専用だよ！',
    usePremium: 'プランの申し込みは `/premium` だよ。`/plan info` で今の状態を見れるよ',
    currentPlan: (label: string, max: number) => `**今のプラン:** ${label}（${max}人まで）`,
    friendCount: (current: number, max: number) => `**友達:** ${current}/${max}人`,
    premiumUntil: (date: string) => `**プレミアム期限:** ${date} まで`,
    premiumRenew: '更新・再申込は `/premium` からだよ✨',
    premiumUpsell: (price: string) =>
      `5人まで使うには **月額${price}円** のプレミアムが必要だよ。\n\`/premium\` でPayPayの案内を見てね👻`,
    premiumActive: (until: string) => `**プレミアム:** 有効（${until} まで）✨`,
    premiumExpired: '**プレミアム:** 期限切れ（ロール解除済み）',
    premiumInactive: '**プレミアム:** まだ未加入だよ',
  },

  premium: {
    dmOnly: '/premium はﾎﾞｸとのDM専用だよ！',
    reportInDm: '支払い報告はﾎﾞｸとのDMで `/premium` してからね',
    modalFailed: '申請フォーム開けなかった… しばらくしてからもう一回ね',
    configError: 'プレミアムの設定がまだ終わってない… 運営に聞いてね',
    displayError: 'プレミアム案内の表示に失敗した… しばらくしてからもう一回ね',
    intro: (lines: string[]) => lines.join('\n'),
    introHeader: '**プレミアムプラン**だよ👻',
    introFeatures: 'プレミアムだとこんなことができるよ✨',
    introFriendSlots: '・友達枠が **5人** まで増える',
    introMore: '・その他いい感じの機能（順次追加予定）',
    introPrice: (price: number) => `**月額:** ${price}円（PayPay・手動確認）`,
    introFlow: '**お支払いの流れ**',
    introSteps: [
      '1. 下のQRからPayPayで送金',
      '2. 「支払い報告する」から申請',
      '3. 申請後、送金画面のスクショをﾎﾞｸのDMに送ってね',
      '4. 運営が確認したらPremiumロール付与（だいたい1〜2営業日）',
    ],
    qrEmbedTitle: 'PayPay送金用QR',
    reportBtn: '支払い報告する',
    reportAccepted: [
      '**支払い報告、受け取ったよ**だｷﾞｬｰｽ✨',
      '',
      '運営が確認するね。続けて **送金画面のスクショ** をこのDMに画像で送ってね。',
      '（添付して送るだけでOK）',
      '',
      '確認できたらPremiumロール付与するよ。結果はDMで教えるね👻',
    ].join('\n'),
    reportSaveError: '申請の保存に失敗した… しばらくしてからもう一回ね',
    approvedDm: (until: string) =>
      [
        '**プレミアム承認されたよ**だｷﾞｬｰｽ✨',
        '',
        `有効期限: ${until} まで`,
        'Premiumロール付与したよ。友達枠も5人まで使えるよ！',
        '',
        'ありがとうね👻',
      ].join('\n'),
    rejectedDm:
      '**支払い、確認できなかった…**\n\n名義・金額・日時・スクショを見直して、必要なら `/premium` からもう一回申請してね',
    expiredDm:
      '**プレミアム期限切れ**だよ…\n\nPremiumロール外したよ。続けたい時は `/premium` からまた申請してね',
  },

  legacy: {
    useNewFlow: '今は `/setup` `/register` `/play` `/notify` を使ってね！',
  },

  common: {
    noUser: 'Discordのユーザー情報が取れなかった…',
    unknownCommand: 'そのコマンドはまだわからない…',
    unknownButton: 'そのボタンはまだわからない…',
    unknownModal: 'そのフォームはまだわからない…',
    adminOnly: 'この操作は管理者だけだよ',
  },
} as const;

export function buildPremiumIntroContent(priceYen: number): string {
  return COPY.premium.intro([
    COPY.premium.introHeader,
    '',
    COPY.premium.introFeatures,
    COPY.premium.introFriendSlots,
    COPY.premium.introMore,
    '',
    COPY.premium.introPrice(priceYen),
    '',
    COPY.premium.introFlow,
    ...COPY.premium.introSteps,
  ]);
}
