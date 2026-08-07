import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware() {
    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
    pages: {
      signIn: "/login",
    },
  },
);

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/workspace/:path*",
    "/seo-audit/:path*",
    "/content/:path*",
    "/keywords/:path*",
    "/projects/:path*",
    "/reports/:path*",
    "/settings/:path*",
  ],
};
