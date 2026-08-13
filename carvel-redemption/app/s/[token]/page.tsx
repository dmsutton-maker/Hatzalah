import StaffScanner from "./StaffScanner";

/**
 * The staff screen. No login, no install — the QR by the register opens exactly this.
 * The token identifies the register; an unknown or disabled one is rejected server-side
 * by redeem(), so there is nothing to validate here.
 */
export default async function StaffPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { token } = await params;
  const query = await searchParams;

  const testMode = query.test === "1";

  return <StaffScanner storeToken={decodeURIComponent(token)} testMode={testMode} />;
}
