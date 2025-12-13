export default function(){if(typeof window!=='undefined'){const u=new URL(location.href);if(u.searchParams.get('code'))location.href='/api/auth/google/callback'+location.search}}
