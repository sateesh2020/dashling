// Reads fan RPM from the SMC (no root needed). Prints fanN=rpm lines.
#include <IOKit/IOKitLib.h>
#include <stdio.h>
#include <string.h>
#include <stdint.h>
typedef struct { uint8_t major, minor, build, reserved; uint16_t release; } V;
typedef struct { uint16_t version, length; uint32_t cpuPLimit, gpuPLimit, memPLimit; } PL;
typedef struct { uint32_t dataSize, dataType; uint8_t dataAttributes; } KI;
typedef struct { uint32_t key; V vers; PL pl; KI ki; uint8_t result, status, data8; uint32_t data32; uint8_t bytes[32]; } KD;
static uint32_t k4(const char *s) { return (s[0] << 24) | (s[1] << 16) | (s[2] << 8) | s[3]; }
static io_connect_t con;
static int call(KD *in, KD *out) { size_t n = sizeof(KD); return IOConnectCallStructMethod(con, 2, in, sizeof(KD), out, &n) == KERN_SUCCESS && out->result == 0; }
static int readkey(const char *key, uint8_t *bytes, uint32_t *size, uint32_t *type) {
  KD in = {0}, out = {0}; in.key = k4(key); in.data8 = 9;            // get key info
  if (!call(&in, &out)) return 0;
  *size = out.ki.dataSize; *type = out.ki.dataType;
  KD in2 = {0}, out2 = {0}; in2.key = k4(key); in2.ki.dataSize = *size; in2.data8 = 5;   // read bytes
  if (!call(&in2, &out2)) return 0;
  memcpy(bytes, out2.bytes, 32); return 1;
}
static int keyAt(uint32_t idx, char *out) { KD in = {0}, o = {0}; in.data8 = 8; in.data32 = idx; if (!call(&in, &o)) return 0; uint32_t k = o.key; out[0]=k>>24; out[1]=k>>16; out[2]=k>>8; out[3]=k; out[4]=0; return 1; }
// `smcfan temps`: CPU performance cores (Tp*), efficiency cores (Te*), GPU average (Tg*). Apple Silicon names; values are degrees C.
static int temps(void) {
  uint8_t b[32]; uint32_t sz, ty, cnt = 0;
  if (!readkey("#KEY", b, &sz, &ty)) { puts("temp_none=1"); return 0; }
  cnt = (b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3];
  static const char *P[] = {"Tp01","Tp05","Tp09","Tp0D","Tp0H","Tp0L","Tp0P","Tp0T","Tp0X","Tp0b","Tp0f","Tp0j","Tp0n","Tp0r"};
  float pc[16], ec[16], gsum = 0, allp[64]; int np = 0, ne = 0, ng = 0, nall = 0; char allk[64][5];
  for (uint32_t i = 0; i < cnt; i++) {
    char k[5]; float f;
    if (!keyAt(i, k) || k[0] != 'T' || !readkey(k, b, &sz, &ty) || ty != k4("flt ")) continue;
    memcpy(&f, b, 4); if (!(f > 5 && f < 130)) continue;
    if (k[1] == 'p' && nall < 64) { strcpy(allk[nall], k); allp[nall++] = f; for (int j = 0; j < 14; j++) if (!strcmp(k, P[j]) && np < 16) pc[np++] = f; }
    else if (k[1] == 'e' && ne < 16) ec[ne++] = f;
    else if (k[1] == 'g') { gsum += f; ng++; }
  }
  if (!np) for (int j = 0; j < nall && np < 16; j++) pc[np++] = allp[j];     // unknown chip: fall back to every CPU sensor
  for (int i = 0; i < np; i++) printf("pcore%d=%.0f\n", i + 1, pc[i]);
  for (int i = 0; i < ne; i++) printf("ecore%d=%.0f\n", i + 1, ec[i]);
  if (ng) printf("gpu=%.0f\n", gsum / ng);
  if (!np && !ne && !ng) puts("temp_none=1");
  return 0;
}
int main(int argc, char **argv) {
  io_service_t s = IOServiceGetMatchingService(0, IOServiceMatching("AppleSMC"));
  if (!s || IOServiceOpen(s, mach_task_self(), 0, &con) != KERN_SUCCESS) { puts("fan_none=1"); return 0; }
  if (argc > 1 && !strcmp(argv[1], "temps")) return temps();
  if (argc > 1 && !strcmp(argv[1], "power")) {     // watts: whole system, DC-in (charger), battery (+ = discharging)
    uint8_t pb[32]; uint32_t ps, pt; const char *keys[] = {"PSTR", "PDTR", "PPBR"}, *names[] = {"sys_w", "adapter_in_w", "batt_w"};
    for (int i = 0; i < 3; i++) if (readkey(keys[i], pb, &ps, &pt) && pt == k4("flt ")) { float f; memcpy(&f, pb, 4); printf("%s=%.1f\n", names[i], f); }
    return 0;
  }
  uint8_t b[32]; uint32_t sz, ty; int n = 0;
  int count = 0;
  if (readkey("FNum", b, &sz, &ty)) count = b[0];
  for (int i = 0; i < count && i < 4; i++) {
    char key[5]; snprintf(key, 5, "F%dAc", i);
    if (!readkey(key, b, &sz, &ty)) continue;
    double rpm;
    if (ty == k4("flt ")) { float f; memcpy(&f, b, 4); rpm = f; }
    else if (ty == k4("fpe2")) rpm = ((b[0] << 8) | b[1]) / 4.0;
    else rpm = (b[0] << 8) | b[1];
    printf("fan%d=%d\n", ++n, (int)rpm);
  }
  if (!n) puts("fan_none=1");
  return 0;
}
