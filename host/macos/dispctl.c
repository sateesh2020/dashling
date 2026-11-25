// Get/set the built-in display brightness (0-100). Uses the private DisplayServices framework, so it is best-effort.
// build: clang -O2 -o dispctl dispctl.c -framework CoreGraphics -framework CoreFoundation
#include <CoreGraphics/CoreGraphics.h>
#include <dlfcn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(int argc, char **argv) {
  void *h = dlopen("/System/Library/PrivateFrameworks/DisplayServices.framework/DisplayServices", RTLD_LAZY);
  if (!h) { puts("brightness_none=1"); return 0; }
  int (*get)(CGDirectDisplayID, float *) = dlsym(h, "DisplayServicesGetBrightness");
  int (*set)(CGDirectDisplayID, float) = dlsym(h, "DisplayServicesSetBrightness");
  CGDirectDisplayID d = CGMainDisplayID(); float v;
  if (argc > 2 && !strcmp(argv[1], "set") && set) { int p = atoi(argv[2]); if (p < 0) p = 0; if (p > 100) p = 100; return set(d, p / 100.0f) == 0 ? 0 : 1; }
  if (get && get(d, &v) == 0) printf("brightness=%d\n", (int)(v * 100 + 0.5)); else puts("brightness_none=1");
  return 0;
}
