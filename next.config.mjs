/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // Ignora erros de ESLint durante o deploy na Vercel
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Ignora erros de TypeScript durante o deploy na Vercel
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
