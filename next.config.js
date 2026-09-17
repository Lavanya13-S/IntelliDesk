/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: { unoptimized: true },
  // Allow server-side packages that use native bindings or Node.js APIs (Next.js 13 key)
  // pdfjs-dist is external so webpack does not try to bundle its ESM worker files
  experimental: {
    serverComponentsExternalPackages: [
      'tesseract.js',
      'sharp',
      'mammoth',
      'xlsx',
      'adm-zip',
      'pdf-parse',
      'pdfjs-dist',
    ],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Avoid bundling native modules that should be required at runtime
      config.externals = [
        ...(config.externals || []),
        'canvas',
        'bufferutil',
        'utf-8-validate',
        'pdf-parse',
        'pdfjs-dist',
      ];
    }
    return config;
  },
};

module.exports = nextConfig;
