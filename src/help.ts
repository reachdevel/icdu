export const USAGE =
  "usage: icdu [-AclnSx] [-H | -L | -P] [-g | -h | -k | -m | --si] [-a | -s | -d depth]\n" +
  "            [-B blocksize] [-I mask] [-t threshold] [--local] [--plain] [file ...]\n";

export const HELP = `icdu - du for macOS that counts files evicted to iCloud as if they were on disk

${USAGE}
Options are those of macOS du(1):
  -A            apparent size instead of disk usage
  -a            an entry for each file
  -B blocksize  count in blocksize-byte blocks (rounded up to 512)
  -c            display a grand total
  -d depth      an entry for each directory this many levels deep
  -g -k -m      1 GiB / 1 KiB / 1 MiB blocks
  -h, --si      human-readable sizes, powers of 1024 / 1000
  -H -L -P      follow symlinks on the command line / everywhere / never (default)
  -I mask       ignore files and directories whose name matches mask
  -l            count a file once per hard link
  -n            ignore files and directories with the nodump flag
  -s            an entry for each operand only
  -t threshold  only directories above (or, if negative, below) threshold
  -x            do not cross mount points
  -r            accepted and ignored (reverses -S)

Extras:
  -S            sort the lines by size, largest first; with -r, smallest first
  --local       count only what is stored on this Mac, exactly like du
                (also ICDU_LOCAL=1)
  --plain       no live table or progress display (also ICDU_PLAIN=1, or CI set)
  --help        show this help
  --version     show the version

On a terminal, \`icdu -s a b c\` fills in each line as soon as its directory has been
scanned, and unreadable entries are counted instead of listed. Output piped or
redirected, and --plain, give plain du-style text and one message per path.
`;
