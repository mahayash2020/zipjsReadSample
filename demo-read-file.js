/* globals zip, document, URL, MouseEvent, alert */

(() => {
  zip.configure({
    workerScripts: {
      inflate: ["z-worker-pako.js", "pako_inflate.min.js"],
    },
  });

  const model = (() => {
    return {
      getEntries(file, options) {
        return new zip.ZipReader(new zip.BlobReader(file)).getEntries(options);
      },
      async getURL(entry, options) {
        return URL.createObjectURL(
          await entry.getData(new zip.BlobWriter(), options)
        );
      },
    };
  })();

  (() => {
    const appContainer = document.getElementById("container");
    const fileInput = document.getElementById("file-input");
    const encodingInput = document.getElementById("encoding-input");
    const fileInputButton = document.getElementById("file-input-button");
    const passwordInput = document.getElementById("password-input");
    const unzipProgress = document.createElement("progress");

    const unzipButton = document.getElementById("unzipButton");
    const unzipParallelButton = document.getElementById("unzipParallelButton");

    let fileList = document.getElementById("file-list");
    // フォルダハンドル退避用
    let dirHandleMap = new Map();
    fileInputButton.addEventListener(
      "click",
      () => fileInput.dispatchEvent(new MouseEvent("click")),
      false
    );
    let entries,
      selectedFile = null;
    passwordInput.onchange = async () =>
      fileList
        .querySelectorAll("a[download]")
        .forEach((anchor) => (anchor.download = ""));
    fileInput.onchange = async () => {
      try {
        fileInputButton.disabled = true;
        encodingInput.disabled = true;
        selectedFile = fileInput.files[0];
        await loadFiles();
      } catch (error) {
        alert(error);
      } finally {
        fileInputButton.disabled = false;
        fileInput.value = "";
      }
    };
    encodingInput.onchange = async () => {
      try {
        encodingInput.disabled = true;
        fileInputButton.disabled = true;
        await loadFiles(encodingInput.value);
      } catch (error) {
        alert(error);
      } finally {
        fileInputButton.disabled = false;
      }
    };
    appContainer.addEventListener(
      "click",
      async (event) => {
        const target = event.target;
        if (target.dataset.entryIndex !== undefined && !target.download) {
          event.preventDefault();
          try {
            await download(
              entries[Number(target.dataset.entryIndex)],
              target.parentElement,
              target
            );
          } catch (error) {
            alert(error);
          }
        }
      },
      false
    );

    /**
     * ファイル内容書込処理
     * @param {*} fileHandle ファイルハンドル
     * @param {*} contents ファイル内容(BLOBなど)
     */
    async function writeFile(fileHandle, contents) {
      // Create a FileSystemWritableFileStream to write to.
      let writable = await fileHandle.createWritable();
      // Write the contents of the file to the stream.
      await writable.write(contents);
      // Close the file and write the contents to disk.
      await writable.close();
    }
    /**
     * フォルダハンドル作成処理
     * フォルダハンドルがまだ作られていない場合、フォルダハンドルを作成し、Mapに詰める。
     * 子フォルダが存在する場合、当処理を再帰的に行う。
     * @param {*} _comps 対象ファイルのファイルパスを"/"で分割した配列
     * @param {*} _count compsのうち、処理中の階層を表す
     * @param {*} _parentDirHandle 親フォルダハンドル
     */
    async function createDirHandleMap(_comps, _count, _parentDirHandle) {
      // まだフォルダが作られていない場合
      if (dirHandleMap.has(_comps[_count]) != -1) {
        let dir = await _parentDirHandle.getDirectoryHandle(_comps[_count], {
          create: true,
        });
        // ハンドルをmapに退避
        dirHandleMap.set(_comps[_count], dir);

        // 子フォルダが存在する場合
        if (_count != _comps.length - 2) {
          // 再帰呼び出し
          _count++;
          await createDirHandleMap(_comps, _count, dir);
        }
      }
    }

    // unzip処理(解凍とファイル書込を並行で処理)
    unzipParallelButton.addEventListener("click", async () => {
      if (entries == null) {
        alert("まずzipを読み込んでください。");
        return;
      }

      // 解凍先ローカルフォルダ選択ダイアログ表示（フォルダ選択後にはファイル読取許可アラートが表示される）
      let rootDirHandle = await window.showDirectoryPicker();

      // 編集許可アラートを先に出すために仮フォルダ作成
      await rootDirHandle.getDirectoryHandle("unziptemp", {
        create: true,
      });
      // 編集許可が取れたら作成した仮フォルダを消す
      await rootDirHandle.removeEntry("unziptemp");

      document.getElementById("unzipTime").textContent =
        "unzipTime : 解凍中です。解凍が終了すると解凍にかかった時間を表示します。";

      let startTime = new Date();
      let writeFileCount = 0;

      console.log("zipに含まれるファイル数 : " + entries.length);
      // zip内ファイル取り出し（blob）
      // entries.length がファイル数
      for (entry of entries) {
        console.log(entry.filename + " #1 BLOB変換開始");

        // entryからblobを取り出す。
        entryGetData(entry).then(async (blobMap) => {
          // blobを取り出した後はファイルに書き出す

          let mapIte = blobMap.keys();
          let fileName = mapIte.next().value;
          let blob = blobMap.get(fileName);
          console.log(fileName + " #2-1 BLOB変換終了。ファイルサイズ(BYTE) : " + blob.size);

          // フォルダハンドル作成（フォルダ作成）
          let comps = entry.filename.split("/");
          let parentDirHandle = rootDirHandle;
          // ファイルパスにフォルダを含む場合
          if (comps.length != 1) {
            await createDirHandleMap(comps, 0, rootDirHandle);
            // ファイルを格納するフォルダハンドルを取得（フォルダ取得）
            parentDirHandle = dirHandleMap.get(comps[comps.length - 2]);
          }
          // 空ファイル作成
          let fileHandle = await parentDirHandle.getFileHandle(
            comps[comps.length - 1],
            { create: true }
          );
          // ファイル内容書込
          await writeFile(fileHandle, blob);
          writeFileCount++;
          console.log(
            fileName + " #2-2 ファイル書込終了。書込終了数 : " + writeFileCount
          );
          if (entries.length == writeFileCount) {
            let endTime = new Date();
            let unzipTIme = (endTime.getTime() - startTime.getTime()) / 1000;
            console.log("解凍にかかった時間 : " + unzipTIme + "秒");
            document.getElementById("unzipTime").textContent =
              "unzipTIme : " + unzipTIme + "秒";
          }
        });
      }
    });

    async function entryGetData(entry) {
      let blobMap = new Map();
      let blob = await entry.getData(new zip.BlobWriter(), {});
      blobMap.set(entry.filename, blob);
      return blobMap;
    }

    // unzip処理
    unzipButton.addEventListener("click", async () => {
      if (entries == null) {
        alert("まずzipを読み込んでください。");
        return;
      }

      // 解凍先ローカルフォルダ選択ダイアログ表示（フォルダ選択後にはファイル読取許可アラートが表示される）
      let rootDirHandle = await window.showDirectoryPicker();

      // 編集許可アラートを先に出すために仮フォルダ作成
      await rootDirHandle.getDirectoryHandle("unziptemp", {
        create: true,
      });
      // 編集許可が取れたら作成した仮フォルダを消す
      await rootDirHandle.removeEntry("unziptemp");

      document.getElementById("unzipTime").textContent =
        "unzipTime : 解凍中です。解凍が終了すると解凍にかかった時間を表示します。";

      let startTime = new Date();
      console.log("getEntries before : " + startTime);
      // zip内ファイル取り出し（blob）＆ローカルに書き出し
      for await (entry of entries) {
        let blob = await entry.getData(new zip.BlobWriter(), {});
        console.log(entry.filename + " , size -> " + blob.size);

        // フォルダハンドル作成（フォルダ作成）
        let comps = entry.filename.split("/");
        let parentDirHandle = rootDirHandle;
        // ファイルパスにフォルダを含む場合
        if (comps.length != 1) {
          await createDirHandleMap(comps, 0, rootDirHandle);
          // ファイルを格納するフォルダハンドルを取得（フォルダ取得）
          parentDirHandle = dirHandleMap.get(comps[comps.length - 2]);
        }
        // 空ファイル作成
        let fileHandle = await parentDirHandle.getFileHandle(
          comps[comps.length - 1],
          { create: true }
        );
        // ファイル内容書込
        await writeFile(fileHandle, blob);
      }
      let endTime = new Date();
      console.log("getEntries after : " + endTime);
      let unzipTIme = (endTime.getTime() - startTime.getTime()) / 1000;
      console.log("解凍にかかった時間 : " + unzipTIme + "秒");
      document.getElementById("unzipTime").textContent =
        "unzipTIme : " + unzipTIme + "秒";
    });

    // zip読込 Openボタン押下時処理
    async function loadFiles(filenameEncoding) {
      document.getElementById("unzipFile").textContent = "unzipFile : ";
      document.getElementById("unzipTime").textContent = "unzipTime : ";

      // zip内の情報取り出し
      entries = await model.getEntries(selectedFile, { filenameEncoding });
      document.getElementById("unzipFile").textContent =
        "unzipFile : " + selectedFile.name;

      if (entries && entries.length) {
        fileList.classList.remove("empty");
        const filenamesUTF8 = Boolean(
          !entries.find((entry) => !entry.filenameUTF8)
        );
        const encrypted = Boolean(entries.find((entry) => entry.encrypted));
        encodingInput.value = filenamesUTF8
          ? "utf-8"
          : filenameEncoding || "cp437";
        encodingInput.disabled = filenamesUTF8;
        passwordInput.value = "";
        passwordInput.disabled = !encrypted;
        refreshList();
      }
    }

    function refreshList() {
      const newFileList = fileList.cloneNode();
      entries.forEach((entry, entryIndex) => {
        const li = document.createElement("li");
        const anchor = document.createElement("a");
        anchor.dataset.entryIndex = entryIndex;
        anchor.textContent = anchor.title = entry.filename;
        anchor.title = `${
          entry.filename
        }\n  Last modification date: ${entry.lastModDate.toLocaleString()}`;
        if (!entry.directory) {
          anchor.href = "";
          anchor.title += `\n  Uncompressed size: ${entry.uncompressedSize.toLocaleString()} bytes`;
        }
        li.appendChild(anchor);
        newFileList.appendChild(li);
      });
      fileList.replaceWith(newFileList);
      fileList = newFileList;
    }

    async function download(entry, li, a) {
      li.appendChild(unzipProgress);
      const blobURL = await model.getURL(entry, {
        password: passwordInput.value,
        onprogress: (index, max) => {
          unzipProgress.value = index;
          unzipProgress.max = max;
        },
      });
      const clickEvent = new MouseEvent("click");
      unzipProgress.remove();
      unzipProgress.value = 0;
      unzipProgress.max = 0;
      a.href = blobURL;
      a.download = entry.filename;
      a.dispatchEvent(clickEvent);
    }
  })();
})();
