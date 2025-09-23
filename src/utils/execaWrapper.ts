export interface RunResult {
   stdout: string
   stderr?: string
   exitCode?: number
   statusCode?: number | null
   retryAfterSeconds?: number | null
}

export async function run(
   program: string,
   args: string[],
   options?: Record<string, any>
): Promise<RunResult> {
   // Dynamically import execa to avoid loading the ESM package at module evaluation time
   const execaModule: any = await import('execa')
   const execa = execaModule.execa || execaModule.default || execaModule
   try {
      const proc = await execa(program, args, {
         stdio: 'pipe',
         ...(options || {}),
      })
      return {
         stdout: proc.stdout,
         stderr: proc.stderr,
         exitCode: proc.exitCode,
         statusCode: null,
         retryAfterSeconds: null,
      }
   } catch (err: any) {
      // Try to normalize useful fields. Some CLIs print rate-limit info to stderr.
      const stderr = err.stderr || err.message || ''
      let retryAfterSeconds: number | null = null
      // naive pattern: look for 'Retry-After: <seconds>' or 'retry-after: <seconds>'
      const m = stderr.match(/retry-?after[:\s]+(\d+)/i)
      if (m) retryAfterSeconds = parseInt(m[1], 10)
      const statusCode = err.exitCode ?? null
      return {
         stdout: err.stdout || '',
         stderr,
         exitCode: err.exitCode,
         statusCode,
         retryAfterSeconds,
      }
   }
}

export default { run }
