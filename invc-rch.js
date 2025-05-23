(function() {
  'use strict';

  function getAndroidVersion() {
    if (Lampa.Platform.is('android')) {
      try {
        var current = AndroidJS.appVersion().split('-');

        return parseInt(current.pop());
      } catch (e) {
        return 0;
      }
    } else {
      return 0;
    }
  }
	
  if (!window.rch) {

    window.rch = {
      type: undefined,
      startTypeInvoke: false,
      apkVersion: getAndroidVersion()
    };


    window.rch.typeInvoke = function rchtypeInvoke(host, call) {
      if (window.rch.type == undefined) {
        window.rch.startTypeInvoke = true;
        var check = function check(good) {
          window.rch.type = Lampa.Platform.is('android') ? 'apk' : good ? 'cors' : 'web';
          call();
        };

        if (Lampa.Platform.is('android') || Lampa.Platform.is('tizen')) check(true);
        else {
          var net = new Lampa.Reguest();
          net.silent('http://smotret24.ru'.indexOf(location.host) >= 0 ? 'https://github.com/' : host+'/cors/check', function() {
            check(true);
          }, function() {
            check(false);
          }, false, {
            dataType: 'text'
          });
        }
      } else call();
    };


    window.rch.Registry = function RchRegistry(toresult, hubConnection, startConnection) {
      window.rch.typeInvoke('http://smotret24.ru', function() {
        hubConnection.invoke("RchRegistry", JSON.stringify({
          version: 142,
          host: location.host,
          href: location.href,
          rchtype: window.rch.type,
          apkVersion: window.rch.apkVersion
        })).then(function() {
          startConnection();
          hubConnection.on("RchClient", function(rchId, url, data, headers, returnHeaders) {
            console.log('RCH', url);
			var network = new Lampa.Reguest();
            function result(html) {
              if (Lampa.Arrays.isObject(html) || Lampa.Arrays.isArray(html)) {
                html = JSON.stringify(html);
              }
              network.silent(toresult, false, false, {
                id: rchId,
                value: html
              }, {
                dataType: 'text',
                timeout: 1000 * 5
              });
            }
            if (url == 'eval') {
              result(eval(data));
            } else {
              network["native"](url, result, function() {
                console.log('RCH', 'result empty');
                result('');
              }, data, {
                dataType: 'text',
                timeout: 1000 * 8,
                headers: headers,
                returnHeaders: returnHeaders
              });
            }
          });
        });
      });
    };
  }

})();
