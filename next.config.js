const nextConfig = {
  output: 'standalone', // Recomendado para deploy no Vercel
  experimental: {
    serverActions: true // Se precisar de Server Actions
  }
}

module.exports = nextConfig