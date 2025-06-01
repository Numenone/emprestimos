const nextConfig = {
  output: 'standalone', // Recomendado para deploy no Vercel
  experimental: {
    serverActions: {}// Se precisar de Server Actions
  }
}

module.exports = nextConfig