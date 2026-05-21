import { CopyFriendCodeClient } from './CopyFriendCodeClient';

export default function CopyFriendCodePage({
  searchParams,
}: {
  searchParams: { c?: string };
}) {
  return <CopyFriendCodeClient code={searchParams.c ?? ''} />;
}
