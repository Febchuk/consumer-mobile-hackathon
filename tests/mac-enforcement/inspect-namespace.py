import argparse
import hashlib
import importlib.util
import json
import os
import pathlib
import subprocess
import tempfile
import uuid


ROOT_READONLY = r'''
import json,os,pathlib,stat,subprocess,sys,time
assert os.geteuid()==0 and len(sys.argv)==2
targets=json.loads(sys.argv[1])
assert isinstance(targets,list) and 0<len(targets)<=24 and all(isinstance(p,str) and p.startswith('/') and len(p)<1024 for p in targets)
paths=sorted({str(q) for value in targets for q in (pathlib.Path(value),*pathlib.Path(value).parents)})
assert len(paths)<=128
records=[]
for name in paths:
 path=pathlib.Path(name);record={'path':name}
 try:
  info=path.lstat();record.update({'resolved':str(path.resolve()),'uid':info.st_uid,'gid':info.st_gid,'mode':oct(stat.S_IMODE(info.st_mode)),'device':info.st_dev,'inode':info.st_ino,'isDirectory':stat.S_ISDIR(info.st_mode),'isSymlink':stat.S_ISLNK(info.st_mode)})
  result=subprocess.run(['/bin/ls','-lde',name],env={'PATH':'/usr/bin:/bin:/usr/sbin:/sbin','HOME':'/var/root','LANG':'C','LC_ALL':'C'},stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=5,check=False)
  assert len(result.stdout)<=16384 and len(result.stderr)<=16384
  record['aclObservation']={'exit':result.returncode,'stdout':result.stdout.decode(errors='replace'),'stderr':result.stderr.decode(errors='replace')}
  if stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode):
   fd=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_NONBLOCK)
   try:
    actual=os.fstat(fd);record['openedDirectoryIdentityMatches']=actual.st_dev==info.st_dev and actual.st_ino==info.st_ino
   finally:os.close(fd)
 except Exception as error:record['observationError']=type(error).__name__+': '+str(error)
 records.append(record)
print(json.dumps({'version':1,'observedAt':int(time.time()*1000),'records':records,'filesystemMutation':False,'admissionGranted':False},sort_keys=True),flush=True)
'''


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--nonce", required=True)
    args = parser.parse_args()
    nonce = str(uuid.UUID(args.nonce)).upper()
    if nonce != args.nonce or uuid.UUID(nonce).version != 4:
        raise RuntimeError("Unique canonical inspection nonce required")
    if os.geteuid() == 0:
        raise RuntimeError("Namespace observation entry must run as the nonroot build user")
    root = pathlib.Path(__file__).resolve().parents[2]
    spec = importlib.util.spec_from_file_location("operator_carrier", pathlib.Path(__file__).with_name("enforcement-entry.py"))
    carrier = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(carrier)
    scratch = pathlib.Path(tempfile.mkdtemp(prefix="calledit-namespace-inspection-")).resolve()
    environment = carrier.build_environment(scratch)

    def query(argv):
        result = subprocess.run(argv, env=environment, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=30, check=True)
        return result.stdout.strip()

    compiler = pathlib.Path(query(["/usr/bin/xcrun", "--sdk", "macosx", "--find", "clang"])).resolve()
    sdk = pathlib.Path(query(["/usr/bin/xcrun", "--sdk", "macosx", "--show-sdk-path"])).resolve()
    resources = pathlib.Path(query([str(compiler), "-print-resource-dir"])).resolve()
    targets = ["/private/var/run", "/private/var/root", "/private/var/root/calledit-qa", "/usr/bin/python3", "/usr/bin/xcrun", str(compiler), str(compiler.parent / "ld"),
               str(sdk), str(resources), str(sdk / "SDKSettings.json"), str(sdk / "SDKSettings.plist"), str(sdk / "usr/lib/libproc.tbd"), str(sdk / "usr/lib/libSystem.tbd")]
    observed = query(["/usr/bin/sudo", "-n", "/usr/bin/python3", "-I", "-S", "-c", ROOT_READONLY, json.dumps(targets)])
    record = {"version": 1, "nonce": nonce, "guestBootSessionUUID": str(uuid.UUID(query(["/usr/sbin/sysctl", "-n", "kern.bootsessionuuid"]))).upper(),
              "inspectorSourceSHA256": hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),
              "rootReadonlyLiteralSHA256": hashlib.sha256(ROOT_READONLY.encode()).hexdigest(), "observation": json.loads(observed),
              "toolchainCandidatesFromUnprivilegedQueries": {"compiler": str(compiler), "sdk": str(sdk), "resources": str(resources)},
              "firewallMutation": False, "rootFilesystemMutation": False, "simulatorCreated": False, "testsExecuted": 0,
              "admissionGranted": False, "scope": "actual read-only path metadata and ACL observation only; no compiler/header integrity, runtime authority, PF, UI or release proof"}
    print("CALLED_IT_NAMESPACE_READONLY " + json.dumps(record, sort_keys=True), flush=True)
    destination = carrier.build_carrier(root, scratch, environment)
    evidence = destination / "QANamespaceInspectionEvidence"
    evidence.mkdir()
    (evidence / "observations.json").write_text(json.dumps(record, indent=2) + "\n")
    (evidence / "README.txt").write_text("Read-only actual namespace observations. No privileged filesystem/PF change, simulator, runtime authority or release proof. Unsigned carrier only, not an RC.\n")


if __name__ == "__main__":
    main()
