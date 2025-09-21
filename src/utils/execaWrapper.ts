export interface RunResult {
   stdout: string
   stderr?: string
   exitCode?: number
}

export async function run(
   program: string,
   args: string[],
   options?: Record<string, any>
): Promise<RunResult> {
   // Dynamically import execa to avoid loading the ESM package at module evaluation time
   const execaModule: any = await import('execa')
   const execa = execaModule.execa || execaModule.default || execaModule
   const proc = await execa(program, args, {
      stdio: 'pipe',
      ...(options || {}),
   })
   return { stdout: proc.stdout, stderr: proc.stderr, exitCode: proc.exitCode }
}

export default { run }
