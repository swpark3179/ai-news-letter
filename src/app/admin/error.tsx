"use client";

import ErrorNotice from "@/components/ui/ErrorNotice";

export default function SegmentError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorNotice {...props} />;
}
