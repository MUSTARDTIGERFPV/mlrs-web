var device = null;
(function() {
    'use strict';

    function hex2bin(arrayBuffer) {
        // Convert ArrayBuffer to string
        const decoder = new TextDecoder('utf-8');
        const hexString = decoder.decode(arrayBuffer);
    
        const lines = hexString.split(/\r?\n/);
        const binary = [];
    
        lines.forEach(line => {
            if (line.length !== 0) {
                // Validate the line starts with ':'
                if (line[0] !== ':') {
                    console.log(line);
                    throw new Error("Invalid Intel HEX format");
                }
    
                // Extract length, address, type, and data
                const length = parseInt(line.substr(1, 2), 16);
                const recordType = parseInt(line.substr(7, 2), 16);
                const data = line.substr(9, length * 2);
    
                // Only handle data records (type 00)
                if (recordType === 0) {
                    for (let i = 0; i < length; i++) {
                        const byte = parseInt(data.substr(i * 2, 2), 16);
                        binary.push(byte);
                    }
                }
            }
        });
    
        // Convert binary array to ArrayBuffer
        const binaryArrayBuffer = new Uint8Array(binary).buffer;
    
        return binaryArrayBuffer;
    }

    function hex4(n) {
        let s = n.toString(16)
        while (s.length < 4) {
            s = '0' + s;
        }
        return s;
    }

    function hexAddr8(n) {
        let s = n.toString(16)
        while (s.length < 8) {
            s = '0' + s;
        }
        return "0x" + s;
    }

    function niceSize(n) {
        const gigabyte = 1024 * 1024 * 1024;
        const megabyte = 1024 * 1024;
        const kilobyte = 1024;
        if (n >= gigabyte) {
            return n / gigabyte + "GiB";
        } else if (n >= megabyte) {
            return n / megabyte + "MiB";
        } else if (n >= kilobyte) {
            return n / kilobyte + "KiB";
        } else {
            return n + "B";
        }
    }

    function formatDFUSummary(device) {
        const vid = hex4(device.device_.vendorId);
        const pid = hex4(device.device_.productId);
        const name = device.device_.productName;

        let mode = "Unknown"
        if (device.settings.alternate.interfaceProtocol == 0x01) {
            mode = "Runtime";
        } else if (device.settings.alternate.interfaceProtocol == 0x02) {
            mode = "DFU";
        }

        const cfg = device.settings.configuration.configurationValue;
        const intf = device.settings["interface"].interfaceNumber;
        const alt = device.settings.alternate.alternateSetting;
        const serial = device.device_.serialNumber;
        let info = `${mode}: [${vid}:${pid}] cfg=${cfg}, intf=${intf}, alt=${alt}, name="${name}" serial="${serial}"`;
        return info;
    }

    function formatDFUInterfaceAlternate(settings) {
        let mode = "Unknown"
        if (settings.alternate.interfaceProtocol == 0x01) {
            mode = "Runtime";
        } else if (settings.alternate.interfaceProtocol == 0x02) {
            mode = "DFU";
        }

        const cfg = settings.configuration.configurationValue;
        const intf = settings["interface"].interfaceNumber;
        const alt = settings.alternate.alternateSetting;
        const name = (settings.name) ? settings.name : "UNKNOWN";

        return `${mode}: cfg=${cfg}, intf=${intf}, alt=${alt}, name="${name}"`;
    }

    async function fixInterfaceNames(device_, interfaces) {
        // Check if any interface names were not read correctly
        if (interfaces.some(intf => (intf.name == null))) {
            // Manually retrieve the interface name string descriptors
            let tempDevice = new dfu.Device(device_, interfaces[0]);
            await tempDevice.device_.open();
            await tempDevice.device_.selectConfiguration(1);
            let mapping = await tempDevice.readInterfaceNames();
            await tempDevice.close();

            for (let intf of interfaces) {
                if (intf.name === null) {
                    let configIndex = intf.configuration.configurationValue;
                    let intfNumber = intf["interface"].interfaceNumber;
                    let alt = intf.alternate.alternateSetting;
                    intf.name = mapping[configIndex][intfNumber][alt];
                }
            }
        }
    }

    function populateInterfaceList(form, device_, interfaces) {
        let old_choices = Array.from(form.getElementsByTagName("div"));
        for (let radio_div of old_choices) {
            form.removeChild(radio_div);
        }

        let button = form.getElementsByTagName("button")[0];

        for (let i=0; i < interfaces.length; i++) {
            let radio = document.createElement("input");
            radio.type = "radio";
            radio.name = "interfaceIndex";
            radio.value = i;
            radio.id = "interface" + i;
            radio.required = true;

            let label = document.createElement("label");
            label.textContent = formatDFUInterfaceAlternate(interfaces[i]);
            label.className = "radio"
            label.setAttribute("for", "interface" + i);

            let div = document.createElement("div");
            div.appendChild(radio);
            div.appendChild(label);
            form.insertBefore(div, button);
        }
    }

    function getDFUDescriptorProperties(device) {
        // Attempt to read the DFU functional descriptor
        // TODO: read the selected configuration's descriptor
        return device.readConfigurationDescriptor(0).then(
            data => {
                let configDesc = dfu.parseConfigurationDescriptor(data);
                let funcDesc = null;
                let configValue = device.settings.configuration.configurationValue;
                if (configDesc.bConfigurationValue == configValue) {
                    for (let desc of configDesc.descriptors) {
                        if (desc.bDescriptorType == 0x21 && desc.hasOwnProperty("bcdDFUVersion")) {
                            funcDesc = desc;
                            break;
                        }
                    }
                }

                if (funcDesc) {
                    return {
                        WillDetach:            ((funcDesc.bmAttributes & 0x08) != 0),
                        ManifestationTolerant: ((funcDesc.bmAttributes & 0x04) != 0),
                        CanUpload:             ((funcDesc.bmAttributes & 0x02) != 0),
                        CanDnload:             ((funcDesc.bmAttributes & 0x01) != 0),
                        TransferSize:          funcDesc.wTransferSize,
                        DetachTimeOut:         funcDesc.wDetachTimeOut,
                        DFUVersion:            funcDesc.bcdDFUVersion
                    };
                } else {
                    return {};
                }
            },
            error => {}
        );
    }

    // Current log div element to append to
    let logContext = null;

    function setLogContext(div) {
        logContext = div;
    };

    function clearLog(context) {
        if (typeof context === 'undefined') {
            context = logContext;
        }
        if (context) {
            context.innerHTML = "";
        }
    }

    function createProgressElements(msg, color = 'teal', hasProgress = true) {
        // Create the first div
        const statusDiv = document.createElement('div');
        statusDiv.classList.add('mb-1', 'text-base', 'font-medium', 'text-slate-700', 'dark:text-slate-200');
        statusDiv.textContent = msg;
	statusDiv.setAttribute('data-original-text', msg);
    
        // Create the outer progress bar div
        const progressOuterDiv = document.createElement('div');
        progressOuterDiv.classList.add('w-full', 'bg-gray-200', 'rounded-full', 'h-2.5', 'mb-4', 'dark:bg-gray-700');
    
        // Create the inner progress bar div
        const progressInnerDiv = document.createElement('div');
        progressInnerDiv.classList.add(`bg-${color}-600`, 'h-2.5', 'rounded-full');
	if (hasProgress) {
        	progressInnerDiv.style.width = '0%';
	} else {
        	progressInnerDiv.style.width = '100%';
	}

    
        // Append the inner div to the outer div
        progressOuterDiv.appendChild(progressInnerDiv);
    
        // Return both elements in an array
        return [statusDiv, progressOuterDiv];
    }


    function updateProgress(parentElement, progress) {
	progress = Math.round(progress, 0);
        // Get the last two children of the parent element
        const statusDiv = parentElement.children[parentElement.children.length - 2];
        const progressOuterDiv = parentElement.children[parentElement.children.length - 1];
        const progressInnerDiv = progressOuterDiv.children[0];
    
        // Get the original status text from the data attribute
        const originalText = statusDiv.getAttribute('data-original-text');
    
        // Update the status text with the percentage
        statusDiv.textContent = `${originalText} - ${progress}%`;
    
        // Update the progress bar width
        progressInnerDiv.style.width = `${progress}%`;
    }

    function logDebug(msg) {
        console.log(msg);
    }

    function logInfo(msg, color, hasProgress) {
	//document.getElementById('downloadLog').textContent += msg + '\n';
	const [statusDiv, progressDiv] = createProgressElements(msg, color, hasProgress);
	downloadBarSection.appendChild(statusDiv);
	downloadBarSection.appendChild(progressDiv);
	console.log(msg);
        /*if (logContext) {
	    document
            let info = document.createElement("p");
            info.className = "info";
            info.textContent = msg;
            logContext.appendChild(info);
        }*/
    }

    function logWarning(msg) {
	console.log(msg);
        if (logContext) {
            let warning = document.createElement("p");
            warning.className = "warning";
            warning.textContent = msg;
            logContext.appendChild(warning);
        }
    }

    function logError(msg) {
	console.log(msg);
        if (logContext) {
            let error = document.createElement("p");
            error.className = "error";
            error.textContent = msg;
            logContext.appendChild(error);
        }
    }

    function logProgress(done, total) {
	console.log(done, total);
	updateProgress(downloadBarSection, done / total * 100);
        /*if (logContext) {
            let progressBar;
            if (logContext.lastChild.tagName.toLowerCase() == "progress") {
                progressBar = logContext.lastChild;
            }
            if (!progressBar) {
                progressBar = document.createElement("progress");
                logContext.appendChild(progressBar);
            }
            progressBar.value = done;
            if (typeof total !== 'undefined') {
                progressBar.max = total;
            }
        }*/
    }

    document.addEventListener('DOMContentLoaded', event => {
        let connectButton = document.querySelector("#connect");
	let deviceInfoSection = document.querySelector('#deviceInfoSection');
        let downloadSection = document.querySelector("#downloadSection");
        let downloadButton = document.querySelector("#download");
        let downloadLogSection = document.querySelector("#downloadLogSection");
        let downloadBarSection = document.querySelector("#downloadBarSection");
        let uploadButton = document.querySelector("#upload");
        let statusDisplay = document.querySelector("#status");
        let infoDisplay = document.querySelector("#usbInfo");
        let dfuDisplay = document.querySelector("#dfuInfo");
        let vidField = document.querySelector("#vid");
        let interfaceDialog = document.querySelector("#interfaceDialog");
        let interfaceForm = document.querySelector("#interfaceForm");
        let interfaceSelectButton = document.querySelector("#selectInterface");

        let searchParams = new URLSearchParams(window.location.search);
        let fromLandingPage = false;
        let vid = 0x0483;
        // Set the vendor ID from the landing page URL
        if (searchParams.has("vid")) {
            const vidString = searchParams.get("vid");
            try {
                if (vidString.toLowerCase().startsWith("0x")) {
                    vid = parseInt(vidString, 16);
                } else {
                    vid = parseInt(vidString, 10);
                }
                vidField.value = "0x" + hex4(vid).toUpperCase();
                fromLandingPage = true;
            } catch (error) {
                console.log("Bad VID " + vidString + ":" + error);
            }
        }

        // Grab the serial number from the landing page
        let serial = "";
        if (searchParams.has("serial")) {
            serial = searchParams.get("serial");
            // Workaround for Chromium issue 339054
            if (window.location.search.endsWith("/") && serial.endsWith("/")) {
                serial = serial.substring(0, serial.length-1);
            }
            fromLandingPage = true;
        }

        let configForm = document.querySelector("#configForm");

        let transferSizeField = document.querySelector("#transferSize");
        let transferSize = transferSizeField.value;

        let dfuseStartAddressField = document.querySelector("#dfuseStartAddress");
        let dfuseUploadSizeField = document.querySelector("#dfuseUploadSize");

        let firmwareFile = null;

        let downloadLog = document.querySelector("#downloadLog");
        let uploadLog = document.querySelector("#uploadLog");

        let manifestationTolerant = true;

        //let device;

        function onDisconnect(reason) {
            if (reason) {
                statusDisplay.textContent = reason;
            }

            connectButton.textContent = "Connect";
            infoDisplay.textContent = "";
            dfuDisplay.textContent = "";
            uploadButton.disabled = true;
            downloadButton.disabled = true;
        }

        function onUnexpectedDisconnect(event) {
            if (device !== null && device.device_ !== null) {
                if (device.device_ === event.device) {
                    device.disconnected = true;
                    onDisconnect("Device disconnected");
                    device = null;
                }
            }
        }

        async function connect(device) {
            try {
                await device.open();
            } catch (error) {
                onDisconnect(error);
                throw error;
            }

            // Attempt to parse the DFU functional descriptor
            let desc = {};
            try {
                desc = await getDFUDescriptorProperties(device);
            } catch (error) {
                onDisconnect(error);
                throw error;
            }

            let memorySummary = "";
            if (desc && Object.keys(desc).length > 0) {
                device.properties = desc;
                let info = `WillDetach=${desc.WillDetach}, ManifestationTolerant=${desc.ManifestationTolerant}, CanUpload=${desc.CanUpload}, CanDnload=${desc.CanDnload}, TransferSize=${desc.TransferSize}, DetachTimeOut=${desc.DetachTimeOut}, Version=${hex4(desc.DFUVersion)}`;
                dfuDisplay.textContent += "\n" + info;
                transferSizeField.value = desc.TransferSize;
                transferSize = desc.TransferSize;
                if (desc.CanDnload) {
                    manifestationTolerant = desc.ManifestationTolerant;
                }

                if (device.settings.alternate.interfaceProtocol == 0x02) {
                    if (!desc.CanUpload) {
                        uploadButton.disabled = true;
                        dfuseUploadSizeField.disabled = true;
                    }
                    if (!desc.CanDnload) {
                        dnloadButton.disabled = true;
                    }
                }

                if (desc.DFUVersion == 0x011a && device.settings.alternate.interfaceProtocol == 0x02) {
                    device = new dfuse.Device(device.device_, device.settings);
                    if (device.memoryInfo) {
                        let totalSize = 0;
                        for (let segment of device.memoryInfo.segments) {
                            totalSize += segment.end - segment.start;
                        }
                        memorySummary = `Selected memory region: ${device.memoryInfo.name} (${niceSize(totalSize)})`;
                        for (let segment of device.memoryInfo.segments) {
                            let properties = [];
                            if (segment.readable) {
                                properties.push("readable");
                            }
                            if (segment.erasable) {
                                properties.push("erasable");
                            }
                            if (segment.writable) {
                                properties.push("writable");
                            }
                            let propertySummary = properties.join(", ");
                            if (!propertySummary) {
                                propertySummary = "inaccessible";
                            }

                            memorySummary += `\n${hexAddr8(segment.start)}-${hexAddr8(segment.end-1)} (${propertySummary})`;
                        }
                    }
                }
            }

            // Bind logging methods
            device.logDebug = logDebug;
            device.logInfo = logInfo;
            device.logWarning = logWarning;
            device.logError = logError;
            device.logProgress = logProgress;

            // Clear logs
            clearLog(uploadLog);
            clearLog(downloadLog);

            // Display basic USB information
            statusDisplay.textContent = '';
            connectButton.textContent = 'Disconnect';
	    deviceInfoSection.classList.remove('hidden');
            infoDisplay.textContent = (
                //"Name: " + device.device_.productName + "\n" +
                "Connected to " + device.device_.manufacturerName + ' SN' + device.device_.serialNumber
            );

            // Display basic dfu-util style info
            dfuDisplay.textContent = formatDFUSummary(device) + "\n" + memorySummary;

            // Update buttons based on capabilities
            if (device.settings.alternate.interfaceProtocol == 0x01) {
                // Runtime
                uploadButton.disabled = true;
                downloadButton.disabled = true;
            } else {
                // DFU
                uploadButton.disabled = false;
                downloadButton.disabled = false;
                downloadSection.classList.remove('hidden');
            }

            if (device.memoryInfo) {
                let dfuseFieldsDiv = document.querySelector("#dfuseFields")
                dfuseFieldsDiv.hidden = false;
                dfuseStartAddressField.disabled = false;
                dfuseUploadSizeField.disabled = false;
                let segment = device.getFirstWritableSegment();
                if (segment) {
                    device.startAddress = segment.start;
                    dfuseStartAddressField.value = "0x" + segment.start.toString(16);
                    const maxReadSize = device.getMaxReadSize(segment.start);
                    dfuseUploadSizeField.value = maxReadSize;
                    dfuseUploadSizeField.max = maxReadSize;
                }
            } else {
                let dfuseFieldsDiv = document.querySelector("#dfuseFields")
                dfuseFieldsDiv.hidden = true;
                dfuseStartAddressField.disabled = true;
                dfuseUploadSizeField.disabled = true;
            }

            return device;
        }

        function autoConnect(vid, serial) {
            dfu.findAllDfuInterfaces().then(
                async dfu_devices => {
                    let matching_devices = [];
                    for (let dfu_device of dfu_devices) {
                        if (serial) {
                            if (dfu_device.device_.serialNumber == serial) {
                                matching_devices.push(dfu_device);
                            }
                        } else if (dfu_device.device_.vendorId == vid) {
                            matching_devices.push(dfu_device);
                        }
                    }

                    if (matching_devices.length == 0) {
                        statusDisplay.textContent = 'No device found.';
                    } else {
                        if (matching_devices.length == 1) {
                            statusDisplay.textContent = 'Connecting...';
                            device = matching_devices[0];
                            console.log(device);
                            device = await connect(device);
                        } else {
                            statusDisplay.textContent = "Multiple DFU interfaces found.";
                        }
                        vidField.value = "0x" + hex4(matching_devices[0].device_.vendorId).toUpperCase();
                        vid = matching_devices[0].device_.vendorId;
                    }
                }
            );
        }

        dfuseStartAddressField.addEventListener("change", function(event) {
            const field = event.target;
            let address = parseInt(field.value, 16);
            if (isNaN(address)) {
                field.setCustomValidity("Invalid hexadecimal start address");
            } else if (device && device.memoryInfo) {
                if (device.getSegment(address) !== null) {
                    device.startAddress = address;
                    field.setCustomValidity("");
                    dfuseUploadSizeField.max = device.getMaxReadSize(address);
                } else {
                    field.setCustomValidity("Address outside of memory map");
                }
            } else {
                field.setCustomValidity("");
            }
        });

        connectButton.addEventListener('click', function() {
            if (device) {
                device.close().then(onDisconnect);
                device = null;
            } else {
                let filters = [];
                if (serial) {
                    filters.push({ 'serialNumber': serial });
                } else if (vid) {
                    filters.push({ 'vendorId': vid });
                }
                navigator.usb.requestDevice({ 'filters': filters }).then(
                    async selectedDevice => {
                        let interfaces = dfu.findDeviceDfuInterfaces(selectedDevice);
                        if (interfaces.length == 0) {
                            console.log(selectedDevice);
                            statusDisplay.textContent = "The selected device does not have any USB DFU interfaces.";
                        } else if (interfaces.length == 1) {
                            await fixInterfaceNames(selectedDevice, interfaces);
                            device = await connect(new dfu.Device(selectedDevice, interfaces[0]));
                        } else {
                            await fixInterfaceNames(selectedDevice, interfaces);
			    const flashInterface = interfaces.find(a => a.name.indexOf('Flash') !== -1)
                            device = await connect(new dfu.Device(selectedDevice, flashInterface));
                        }
                    }
                ).catch(error => {
                    statusDisplay.textContent = error;
                });
            }
        });

        uploadButton.addEventListener('click', async function(event) {
            event.preventDefault();
            event.stopPropagation();
            if (!configForm.checkValidity()) {
                configForm.reportValidity();
                return false;
            }

            if (!device || !device.device_.opened) {
                onDisconnect();
                device = null;
            } else {
                setLogContext(uploadLog);
                clearLog(uploadLog);
                try {
                    let status = await device.getStatus();
                    if (status.state == dfu.dfuERROR) {
                        await device.clearStatus();
                    }
                } catch (error) {
                    device.logWarning("Failed to clear status");
                }

                let maxSize = Infinity;
                if (!dfuseUploadSizeField.disabled) {
                    maxSize = parseInt(dfuseUploadSizeField.value);
                }

                try {
                    const blob = await device.do_upload(transferSize, maxSize);
                    saveAs(blob, "firmware.bin");
                } catch (error) {
                    logError(error);
                }

                setLogContext(null);
            }

            return false;
        });

        downloadButton.addEventListener('click', async function(event) {
            event.preventDefault();
            event.stopPropagation();
            if (!configForm.checkValidity()) {
                configForm.reportValidity();
                return false;
            }

	    const selectElement = document.getElementById('channel');
	    const selectedOption = selectElement.options[selectElement.selectedIndex];
	    const fileUrl = selectedOption.value;
	    console.log(fileUrl);
	    const acceptHeader = selectedOption.getAttribute('data-accept-header');
	    const extension = selectedOption.getAttribute('data-extension');
	    const fileName = fileUrl.split('/').slice(-1)[0].split('.').slice(0, -1).join('.');

            //logInfo(`Downloading firmware ${fileName}`, 'emerald', true);
	    clearLog(downloadBarSection);
            logInfo(`Downloading firmware`, 'emerald', true);
	    let firmwareFile = null;
            
            try {
                const response = await fetch(fileUrl, {
			headers: {
			    'Accept': acceptHeader, // Use the Accept header from the data attributs
			},
                });
            
                if (!response.body) {
                    throw new Error("ReadableStream not supported in the response.");
                }
            
                let totalBytes = 0;
                const contentLength = response.headers.get('content-length');
                if (contentLength) {
                  parseInt(contentLength, 10);
                } else {
                  console.warn("Unable to determine content-length. Attempting fallback...");

                  // Fetch the metadata to get the size
                  const metadataResponse = await fetch(fileUrl); // Fetch without Accept header
                  if (!metadataResponse.ok) {
                    throw new Error("Failed to fetch metadata for size information.");
                  }
                  const metadata = await metadataResponse.json();
                  totalBytes = metadata.size;
                  
                  if (!totalBytes) {
                    throw new Error("Unable to determine the file size from metadata.");
                  }
                }
            
                let downloadedBytes = 0;
                const reader = response.body.getReader();
                const chunks = [];
            
                // Read the data in chunks and log progress
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
            
                    // Update the downloaded bytes count and push the chunk to the array
                    downloadedBytes += value.length;
                    chunks.push(value);
            
                    // Call logProgress with the downloaded bytes and total bytes
                    logProgress(downloadedBytes, totalBytes);
                }
            
                // Combine all chunks into a single ArrayBuffer
                firmwareFile = new Uint8Array(downloadedBytes);
                let offset = 0;
                for (let chunk of chunks) {
                    firmwareFile.set(chunk, offset);
                    offset += chunk.length;
                }
            
                console.log("Firmware file loaded as ArrayBuffer:", firmwareFile.buffer);
            
                // Final progress call to ensure 100% completion is logged
                logProgress(totalBytes, totalBytes);
            
                // Handle .hex files
                if (extension == 'hex') {
                    firmwareFile = hex2bin(firmwareFile);
                }
            
                console.log('File completed');
            
            } catch (error) {
                console.error("Error downloading firmware file:", error);
            }

            if (device && firmwareFile != null) {
                //setLogContext(downloadLog);
                //clearLog(downloadLog);
                downloadLogSection.classList.remove('hidden');
                try {
                    let status = await device.getStatus();
                    if (status.state == dfu.dfuERROR) {
                        await device.clearStatus();
                    }
                } catch (error) {
                    device.logWarning("Failed to clear status");
                }
                await device.do_download(transferSize, firmwareFile, manifestationTolerant).then(
                    () => {
                        logInfo("Done! Go Fly!", 'sky', false);
                        //setLogContext(null);
                        if (!manifestationTolerant) {
                            device.waitDisconnected(5000).then(
                                dev => {
                                    onDisconnect();
                                    device = null;
                                },
                                error => {
                                    // It didn't reset and disconnect for some reason...
                                    console.log("Device unexpectedly tolerated manifestation.");
                                }
                            );
                        }
                    },
                    error => {
                        logError(error);
                        setLogContext(null);
                    }
                )
            }

            //return false;
        });

        // Check if WebUSB is available
        if (typeof navigator.usb !== 'undefined') {
            navigator.usb.addEventListener("disconnect", onUnexpectedDisconnect);
            // Try connecting automatically
            if (fromLandingPage) {
                autoConnect(vid, serial);
            }
        } else {
            statusDisplay.textContent = 'WebUSB not available.'
            connectButton.disabled = true;
        }
    });
})();
